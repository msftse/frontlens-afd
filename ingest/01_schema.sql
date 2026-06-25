-- FrontLens - ClickHouse schema for Azure Front Door access logs.
-- The analytical backbone for high volume (>50M req/day → billions of rows / 90d).
--
-- Geo/ASN enrichment is written as columns at INGESTION time (raw AFD logs have
-- no country/city/ASN). The mock loader writes enriched rows directly; the
-- Event Hub path enriches via the geoip dictionary (see geoip_dictionary.sql).

CREATE DATABASE IF NOT EXISTS afd;

CREATE TABLE IF NOT EXISTS afd.access_logs
(
    timestamp          DateTime64(3, 'UTC'),
    trackingRef        String,
    method             LowCardinality(String),
    httpVersion        LowCardinality(String),
    scheme             LowCardinality(String),
    host               LowCardinality(String),
    path               String,
    query              String,
    url                String,
    status             UInt16,
    protocol           LowCardinality(String),
    requestBytes       UInt32,
    responseBytes      UInt64,
    timeTaken          Float32,
    timeToFirstByte    Float32,
    clientIp           String,
    socketIp           String,
    clientPort         UInt32,
    country            LowCardinality(String),
    countryName        LowCardinality(String),
    city               String,
    latitude           Float32,
    longitude          Float32,
    asn                UInt32,
    asnOrg             LowCardinality(String),
    userAgent          String,
    uaFamily           LowCardinality(String),
    uaOs               LowCardinality(String),
    deviceType         LowCardinality(String),
    ja4                String,
    referer            String,
    endpoint           LowCardinality(String),
    pop                LowCardinality(String),
    cacheStatus        LowCardinality(String),
    routeName          LowCardinality(String),
    ruleSetName        LowCardinality(String),
    securityProtocol   LowCardinality(String),
    errorInfo          LowCardinality(String),
    originName         LowCardinality(String),
    originStatus       UInt16,

    -- Derived helpers for fast filtering / grouping
    statusClass        UInt8 MATERIALIZED toUInt8(intDiv(status, 100)),
    clientIpNum        UInt32 MATERIALIZED IPv4StringToNumOrDefault(clientIp),
    hostPath           String MATERIALIZED concat(host, path),

    -- Skip indexes for needle lookups on high-cardinality columns
    INDEX idx_clientip clientIp TYPE bloom_filter GRANULARITY 4,
    INDEX idx_path     path     TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4,
    INDEX idx_tracking trackingRef TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (host, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
