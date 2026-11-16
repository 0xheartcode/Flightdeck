FROM grafana/grafana:11.3.1

# The heart of "alerts as code": bake the repo's provisioning/ into the image.
# Grafana loads datasources, dashboards, and alert rules from here on boot, so
# rebuilding the image (which a git-connected deploy does on every push to main)
# makes the new rules live. The file is the blast radius: a bad rule file can
# crash Grafana on boot, so review the YAML like any other code.
COPY provisioning /etc/grafana/provisioning

# Railway scar: the persistent volume is mounted root-owned, but the stock
# image runs as uid 472 and then cannot write /var/lib/grafana (crash-loop).
# Running as root sidesteps it. Harmless locally.
USER root
