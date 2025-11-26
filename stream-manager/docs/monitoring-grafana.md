# Grafana Dashboard Setup

This guide covers how to set up Grafana to visualize Stream Manager metrics using the pre-built dashboard template.

## Prerequisites

- Stream Manager running with metrics enabled (default)
- Prometheus configured to scrape Stream Manager metrics
- Grafana 9.0+ installed

## Quick Start with Docker Compose

Add the following to your `docker-compose.yml`:

```yaml
services:
  prometheus:
    image: prom/prometheus:v2.45.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    ports:
      - "9090:9090"
    networks:
      - stream-manager

  grafana:
    image: grafana/grafana:10.0.0
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - ./grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    ports:
      - "3000:3000"
    networks:
      - stream-manager
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:

networks:
  stream-manager:
    driver: bridge
```

Create `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'stream-manager'
    static_configs:
      - targets: ['stream-manager:3001']
    metrics_path: '/metrics'
    # If using METRICS_API_KEY:
    # authorization:
    #   type: Bearer
    #   credentials: your-api-key-here
```

## Dashboard Features

The pre-built dashboard (`grafana/dashboards/stream-manager.json`) includes:

### Overview Section
- **Total Containers**: Current count of all page-stream containers
- **Running Containers**: Number of containers in running state
- **Unhealthy Containers**: Containers with health check failures
- **Active Users**: Users with activity in the last hour
- **Alert Rules**: Total configured alert rules
- **Stream Groups**: Total stream groups

### Container Status Section
- **Containers by Status**: Time series chart showing running, stopped, restarting, exited
- **Containers by Health**: Time series chart showing healthy, unhealthy, starting, none
- **Running Container Ratio**: Gauge showing percentage of running containers
- **Healthy Container Ratio**: Gauge showing percentage of healthy containers
- **Status Distribution**: Pie chart of container statuses
- **Health Distribution**: Pie chart of container health states

### Alerts & Schedules Section
- **Alert Events by State**: Shows triggered, acknowledged, resolved alerts over time
- **Schedules**: Shows enabled vs disabled schedules over time

### User Activity Section
- **Active Users Over Time**: Time series of active user count
- **API Requests by User**: Requests per user (requires `METRICS_INCLUDE_USER_REQUESTS=true`)

### System Overview Section
- **Resource Counts Over Time**: Combined view of containers, groups, alerts, and schedules

## Manual Dashboard Import

If not using provisioning:

1. Open Grafana at `http://localhost:3000`
2. Go to **Dashboards** > **Import**
3. Upload `grafana/dashboards/stream-manager.json` or paste its contents
4. Select your Prometheus data source
5. Click **Import**

## Configuration

### Dashboard Variables

The dashboard uses a `datasource` variable that automatically lists available Prometheus data sources. Select the correct one from the dropdown at the top of the dashboard.

### Refresh Rate

Default refresh rate is 30 seconds. Adjust via the refresh dropdown or dashboard settings.

### Time Range

Default time range is "Last 1 hour". Adjust using Grafana's time picker.

## Metrics Reference

| Metric | Type | Description |
|--------|------|-------------|
| `stream_manager_containers_total` | Gauge | Total number of page-stream containers |
| `stream_manager_containers_by_status{status}` | Gauge | Containers by status (running, stopped, etc.) |
| `stream_manager_containers_by_health{health}` | Gauge | Containers by health (healthy, unhealthy, etc.) |
| `stream_manager_active_users` | Gauge | Users active in the last hour |
| `stream_manager_api_requests_by_user{user}` | Gauge | API requests by user (optional) |
| `stream_manager_alert_rules_total` | Gauge | Total alert rules configured |
| `stream_manager_alert_events_by_state{state}` | Gauge | Alert events by state |
| `stream_manager_schedules_total` | Gauge | Total schedules |
| `stream_manager_schedules_enabled` | Gauge | Enabled schedules |
| `stream_manager_schedules_disabled` | Gauge | Disabled schedules |
| `stream_manager_groups_total` | Gauge | Total stream groups |
| `stream_manager_info{version}` | Gauge | Application info (always 1) |

## Alerting

Configure Grafana alerts based on these metrics:

### Example: Unhealthy Container Alert

```yaml
alert: UnhealthyContainers
expr: stream_manager_containers_by_health{health="unhealthy"} > 0
for: 5m
labels:
  severity: warning
annotations:
  summary: "Unhealthy containers detected"
  description: "{{ $value }} containers are unhealthy"
```

### Example: No Running Containers

```yaml
alert: NoRunningContainers
expr: stream_manager_containers_by_status{status="running"} == 0
for: 2m
labels:
  severity: critical
annotations:
  summary: "No running containers"
  description: "All page-stream containers have stopped"
```

## Troubleshooting

### No Data in Dashboard

1. Verify Stream Manager is running: `curl http://localhost:3001/metrics`
2. Check Prometheus targets: `http://localhost:9090/targets`
3. Verify Prometheus can reach Stream Manager
4. Check for METRICS_API_KEY mismatch

### Metrics Endpoint Disabled

If `/metrics` returns 404, set `METRICS_ENABLED=true` in Stream Manager environment.

### Authentication Issues

If using `METRICS_API_KEY`, configure Prometheus:

```yaml
scrape_configs:
  - job_name: 'stream-manager'
    authorization:
      type: Bearer
      credentials: your-api-key
    static_configs:
      - targets: ['stream-manager:3001']
```

## Customization

### Adding Custom Panels

1. Click **Add** > **Visualization** in Grafana
2. Select Prometheus data source
3. Use the metrics documented above
4. Example query: `rate(stream_manager_api_requests_by_user[5m])`

### Modifying Thresholds

Edit panel settings to adjust threshold colors for gauges and stats. For example, change unhealthy container warning threshold from 1 to 2.
