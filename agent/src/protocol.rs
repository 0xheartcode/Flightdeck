//! Wire protocol (agent -> control plane), version 1.
//!
//! This mirrors `packages/protocol/src/messages.ts` on the TypeScript side.
//! Keep the two in sync: field names are camelCase on the wire, the message
//! tag is `type`, and every message carries `v` (the protocol version).

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;

/// A command sent by the control plane to the agent (control plane -> agent).
/// Actions are allowlisted on the agent; anything unknown is rejected.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingCommand {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub action: String,
    #[allow(dead_code)]
    pub service_id: String,
    pub container_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub container_id: String,
    pub state: String,
    pub host: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub service_id: String,
    pub stream: &'static str,
    pub ts: i64,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub v: u8,
    pub agent_id: String,
    pub hostname: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMsg {
    pub v: u8,
    pub service: ServiceInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGone {
    pub v: u8,
    pub service_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusMsg {
    pub v: u8,
    pub service_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogMsg {
    pub v: u8,
    pub log: LogLine,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub service_id: String,
    pub cpu_pct: f64,
    pub mem_bytes: u64,
    pub mem_limit_bytes: u64,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsMsg {
    pub v: u8,
    pub stats: Stats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub v: u8,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Internally tagged: each variant serialises to `{ "type": "...", ... }`
/// with the inner struct's fields merged alongside the tag.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentMessage {
    Hello(Hello),
    Service(ServiceMsg),
    ServiceGone(ServiceGone),
    Status(StatusMsg),
    Log(LogMsg),
    Stats(StatsMsg),
    CommandResult(CommandResult),
}

impl AgentMessage {
    pub fn hello(agent_id: String, hostname: String) -> Self {
        AgentMessage::Hello(Hello {
            v: PROTOCOL_VERSION,
            agent_id,
            hostname,
        })
    }

    pub fn service(service: ServiceInfo) -> Self {
        AgentMessage::Service(ServiceMsg {
            v: PROTOCOL_VERSION,
            service,
        })
    }

    pub fn service_gone(service_id: String) -> Self {
        AgentMessage::ServiceGone(ServiceGone {
            v: PROTOCOL_VERSION,
            service_id,
        })
    }

    pub fn status(service_id: String, state: String, exit_code: Option<i64>, ts: i64) -> Self {
        AgentMessage::Status(StatusMsg {
            v: PROTOCOL_VERSION,
            service_id,
            state,
            exit_code,
            ts,
        })
    }

    pub fn log(log: LogLine) -> Self {
        AgentMessage::Log(LogMsg {
            v: PROTOCOL_VERSION,
            log,
        })
    }

    pub fn stats(stats: Stats) -> Self {
        AgentMessage::Stats(StatsMsg {
            v: PROTOCOL_VERSION,
            stats,
        })
    }

    pub fn command_result(id: String, ok: bool, error: Option<String>) -> Self {
        AgentMessage::CommandResult(CommandResult {
            v: PROTOCOL_VERSION,
            id,
            ok,
            error,
        })
    }
}
