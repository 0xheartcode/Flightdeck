//! WebSocket client to the control plane. Maintains a single connection,
//! sends a `hello` on connect, forwards outgoing messages, sends periodic
//! heartbeats, and reconnects with exponential backoff plus jitter.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc::Receiver;
use tokio::time::interval;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::ClientRequestBuilder;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::http::Uri;

use crate::protocol::AgentMessage;

const HEARTBEAT_SECS: u64 = 30;

pub async fn run(
    url: String,
    token: String,
    agent_id: String,
    hostname: String,
    mut rx: Receiver<AgentMessage>,
) {
    let mut attempt: u32 = 0;
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
                attempt = 0;

                let hello = AgentMessage::hello(agent_id.clone(), hostname.clone());
                if send(&mut ws, &hello).await.is_err() {
                    sleep_backoff(attempt).await;
                    attempt = attempt.saturating_add(1);
                    continue;
                }

                // App-level heartbeat so half-open TCP connections are noticed
                // promptly (a failed ping send breaks us out to reconnect).
                let mut heartbeat = interval(Duration::from_secs(HEARTBEAT_SECS));

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
                        _ = heartbeat.tick() => {
                            if ws.send(Message::Ping(Vec::new().into())).await.is_err() {
                                break;
                            }
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
                tracing::warn!(error = %err, attempt, "control plane unreachable; retrying");
            }
        }
        sleep_backoff(attempt).await;
        attempt = attempt.saturating_add(1);
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

/// Exponential backoff (1,2,4,8,16,32s cap) with sub-second jitter so a fleet
/// of agents does not reconnect in lockstep against a restarted control plane.
async fn sleep_backoff(attempt: u32) {
    let base_secs = (1u64 << attempt.min(5)).min(32);
    let jitter_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() % 1000) as u64)
        .unwrap_or(0);
    tokio::time::sleep(Duration::from_millis(base_secs * 1000 + jitter_ms)).await;
}
