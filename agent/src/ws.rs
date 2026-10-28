//! WebSocket client to the control plane. Maintains a single connection,
//! sends a `hello` on connect, forwards outgoing messages, and reconnects
//! with a fixed backoff if the connection drops.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc::Receiver;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::ClientRequestBuilder;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::http::Uri;

use crate::protocol::AgentMessage;

pub async fn run(
    url: String,
    token: String,
    agent_id: String,
    hostname: String,
    mut rx: Receiver<AgentMessage>,
) {
    loop {
        let request = match build_request(&url, &token) {
            Ok(request) => request,
            Err(err) => {
                tracing::error!(error = %err, "invalid control plane URL");
                return;
            }
        };
        match connect_async(request).await {
            Ok((mut ws, _)) => {
                tracing::info!("connected to control plane");

                let hello = AgentMessage::hello(agent_id.clone(), hostname.clone());
                if send(&mut ws, &hello).await.is_err() {
                    sleep_backoff().await;
                    continue;
                }

                loop {
                    tokio::select! {
                        outgoing = rx.recv() => match outgoing {
                            Some(msg) => {
                                if send(&mut ws, &msg).await.is_err() {
                                    break;
                                }
                            }
                            None => return, // channel closed: agent is shutting down
                        },
                        incoming = ws.next() => match incoming {
                            Some(Ok(Message::Ping(payload))) => {
                                let _ = ws.send(Message::Pong(payload)).await;
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Err(err)) => {
                                tracing::warn!(error = %err, "control plane connection error");
                                break;
                            }
                            _ => {}
                        },
                    }
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "control plane unreachable; retrying");
            }
        }
        sleep_backoff().await;
    }
}

async fn send(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    msg: &AgentMessage,
) -> Result<(), ()> {
    let json = match serde_json::to_string(msg) {
        Ok(json) => json,
        Err(err) => {
            tracing::error!(error = %err, "failed to serialize message");
            return Ok(());
        }
    };
    ws.send(Message::Text(json.into())).await.map_err(|_| ())
}

/// Build the handshake request, carrying the token in an `Authorization`
/// header rather than the URL query so it does not land in proxy or access
/// logs.
fn build_request(
    url: &str,
    token: &str,
) -> Result<ClientRequestBuilder, Box<dyn std::error::Error>> {
    let uri: Uri = url.parse()?;
    let mut builder = ClientRequestBuilder::new(uri);
    if !token.is_empty() {
        builder = builder.with_header("Authorization", format!("Bearer {token}"));
    }
    Ok(builder)
}

async fn sleep_backoff() {
    tokio::time::sleep(Duration::from_secs(3)).await;
}
