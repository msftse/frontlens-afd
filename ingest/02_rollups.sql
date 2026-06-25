-- FrontLens - production rollups (AggregatingMergeTree + materialized views).
--
-- The adapter can query raw `access_logs` (ClickHouse handles billions of rows
-- with partition pruning), but at very high volume these pre-aggregations make
-- the heavy dashboard panels effectively O(buckets). `uniqState` gives exact-ish
-- unique-visitor counts; `quantileState` gives latency percentiles.

-- 1) Traffic by 1-minute bucket × host × country × statusClass × cacheStatus
CREATE TABLE IF NOT EXISTS afd.rollup_traffic_1m
(
    bucket       DateTime('UTC'),
    host         LowCardinality(String),
    country      LowCardinality(String),
    countryName  LowCardinality(String),
    statusClass  UInt8,
    cacheStatus  LowCardinality(String),
    requests     UInt64,
    bytes        UInt64,
    visitors     AggregateFunction(uniq, String),
    latency      AggregateFunction(quantiles(0.5, 0.95), Float32),
    latencySum   Float64
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMMDD(bucket)
ORDER BY (host, country, countryName, statusClass, cacheStatus, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS afd.mv_traffic_1m TO afd.rollup_traffic_1m AS
SELECT
    toStartOfMinute(timestamp) AS bucket,
    host,
    country,
    countryName,
    statusClass,
    cacheStatus,
    count()                    AS requests,
    sum(responseBytes)         AS bytes,
    uniqState(clientIp)        AS visitors,
    quantilesState(0.5, 0.95)(timeTaken) AS latency,
    sum(timeTaken)             AS latencySum
FROM afd.access_logs
GROUP BY bucket, host, country, countryName, statusClass, cacheStatus;

-- 2) Path popularity (hourly) with unique visitors per path
CREATE TABLE IF NOT EXISTS afd.rollup_paths_1h
(
    bucket      DateTime('UTC'),
    host        LowCardinality(String),
    path        String,
    requests    UInt64,
    bytes       UInt64,
    err         UInt64,
    visitors    AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMMDD(bucket)
ORDER BY (host, path, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS afd.mv_paths_1h TO afd.rollup_paths_1h AS
SELECT
    toStartOfHour(timestamp) AS bucket,
    host,
    path,
    count()                  AS requests,
    sum(responseBytes)       AS bytes,
    countIf(status >= 400)   AS err,
    uniqState(clientIp)      AS visitors
FROM afd.access_logs
GROUP BY bucket, host, path;

-- Example read against a rollup (last 24h top countries):
--   SELECT country, sum(requests) AS requests, uniqMerge(visitors) AS visitors
--   FROM afd.rollup_traffic_1m
--   WHERE bucket >= now() - INTERVAL 1 DAY
--   GROUP BY country ORDER BY requests DESC LIMIT 50;
