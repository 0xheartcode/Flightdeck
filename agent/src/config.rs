use clap::Parser;

/// Flightdeck-CD agent: watches labelled containers on this host and streams
/// their logs and status to the control plane.
#[derive(Debug, Clone, Parser)]
#[command(name = "flightdeck-agent", version, about)]
pub struct Config {
    /// WebSocket URL of the control plane's agent endpoint.
    #[arg(
        long,
        env = "FD_CONTROL_PLANE_URL",
        default_value = "ws://localhost:4000/agent"
    )]
    pub control_plane_url: String,

    /// Shared bearer token used to authenticate to the control plane.
    #[arg(long, env = "FD_AGENT_TOKEN", default_value = "")]
    pub token: String,

    /// Docker/Podman API socket. Defaults to the local socket when unset.
    /// Example: unix:///run/user/1000/podman/podman.sock
    #[arg(long, env = "FD_DOCKER_HOST")]
    pub docker_host: Option<String>,

    /// Only containers with this label set to "true" are tracked.
    #[arg(long, env = "FD_LABEL", default_value = "flightdeck.enable")]
    pub label: String,

    /// Seconds between container discovery scans.
    #[arg(long, env = "FD_SCAN_INTERVAL", default_value_t = 5)]
    pub scan_interval: u64,

    /// This host's name, reported with every service.
    #[arg(long, env = "HOSTNAME", default_value = "unknown-host")]
    pub hostname: String,

    /// Collect each container's environment variables and report them to the
    /// control plane. OFF by default: env values are secrets, and this exposes
    /// them to the control plane (which masks them in the UI unless an operator
    /// with the right role reveals them). Opt in only on trusted deployments.
    #[arg(long, env = "FD_COLLECT_ENV", default_value_t = false)]
    pub collect_env: bool,
}

impl Config {
    pub fn load() -> Self {
        Config::parse()
    }
}
