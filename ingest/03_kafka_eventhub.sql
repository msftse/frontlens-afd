-- FrontLens — ingest Azure Front Door access logs from Azure Event Hubs.
--
-- AFD → Diagnostic Setting → Event Hub. Event Hubs exposes a Kafka-compatible
-- endpoint, so ClickHouse's Kafka engine can consume it directly.
--
-- Fill in <NAMESPACE>, <EVENTHUB>, and <CONNECTION_STRING> (the SAS connection
-- string for a Listen policy). Then a materialized view parses the AFD JSON
-- envelope and enriches geo via the dictionary (see geoip_dictionary.sql).

CREATE TABLE IF NOT EXISTS afd.kafka_raw
(
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list  = '<NAMESPACE>.servicebus.windows.net:9093',
    kafka_topic_list   = '<EVENTHUB>',
    kafka_group_name   = 'clickhouse-frontlens',
    kafka_format       = 'RawBLOB',
    kafka_row_delimiter = '\n',
    kafka_security_protocol = 'SASL_SSL',
    kafka_sasl_mechanism    = 'PLAIN',
    kafka_sasl_username     = '$ConnectionString',
    kafka_sasl_password     = '<CONNECTION_STRING>';

-- AFD wraps each access log line in { "records": [ { time, category, properties:{...} } ] }.
-- We explode records and map AFD property names → our columns, enriching geo by clientIp.
CREATE MATERIALIZED VIEW IF NOT EXISTS afd.mv_kafka_to_access TO afd.access_logs AS
WITH JSONExtractArrayRaw(raw, 'records') AS recs
SELECT
    parseDateTime64BestEffortOrZero(JSONExtractString(rec, 'time'), 3, 'UTC')          AS timestamp,
    JSONExtractString(props, 'trackingReference')                                       AS trackingRef,
    JSONExtractString(props, 'httpMethod')                                              AS method,
    JSONExtractString(props, 'httpVersion')                                             AS httpVersion,
    if(JSONExtractString(props, 'requestProtocol') = 'HTTPS', 'https', 'http')          AS scheme,
    JSONExtractString(props, 'hostName')                                                AS host,
    path(JSONExtractString(props, 'requestUri'))                                        AS path,
    queryString(JSONExtractString(props, 'requestUri'))                                 AS query,
    JSONExtractString(props, 'requestUri')                                              AS url,
    toUInt16OrZero(JSONExtractString(props, 'httpStatusCode'))                          AS status,
    JSONExtractString(props, 'requestProtocol')                                         AS protocol,
    JSONExtractUInt(props, 'requestBytes')                                              AS requestBytes,
    JSONExtractUInt(props, 'responseBytes')                                             AS responseBytes,
    JSONExtractFloat(props, 'timeTaken')                                                AS timeTaken,
    JSONExtractFloat(props, 'timeToFirstByte')                                          AS timeToFirstByte,
    JSONExtractString(props, 'clientIp')                                                AS clientIp,
    JSONExtractString(props, 'socketIp')                                                AS socketIp,
    JSONExtractUInt(props, 'clientPort')                                                AS clientPort,
    dictGetOrDefault('afd.geoip', 'country', tuple(IPv4StringToNumOrDefault(clientIp)), '') AS country,
    dictGetOrDefault('afd.geoip', 'countryName', tuple(IPv4StringToNumOrDefault(clientIp)), '') AS countryName,
    dictGetOrDefault('afd.geoip', 'city', tuple(IPv4StringToNumOrDefault(clientIp)), '') AS city,
    dictGetOrDefault('afd.geoip', 'lat', tuple(IPv4StringToNumOrDefault(clientIp)), toFloat32(0)) AS latitude,
    dictGetOrDefault('afd.geoip', 'lon', tuple(IPv4StringToNumOrDefault(clientIp)), toFloat32(0)) AS longitude,
    dictGetOrDefault('afd.asn', 'asn', tuple(IPv4StringToNumOrDefault(clientIp)), toUInt32(0)) AS asn,
    dictGetOrDefault('afd.asn', 'org', tuple(IPv4StringToNumOrDefault(clientIp)), '')   AS asnOrg,
    JSONExtractString(props, 'userAgent')                                               AS userAgent,
    ''                                                                                   AS uaFamily,
    ''                                                                                   AS uaOs,
    'desktop'                                                                            AS deviceType,
    JSONExtractString(props, 'sslJA4')                                                   AS ja4,
    JSONExtractString(props, 'referer')                                                 AS referer,
    JSONExtractString(props, 'endpoint')                                                AS endpoint,
    JSONExtractString(props, 'pop')                                                      AS pop,
    JSONExtractString(props, 'cacheStatus')                                              AS cacheStatus,
    JSONExtractString(props, 'routeName')                                                AS routeName,
    JSONExtractString(props, 'matchedRulesSetName')                                      AS ruleSetName,
    JSONExtractString(props, 'securityProtocol')                                         AS securityProtocol,
    JSONExtractString(props, 'errorInfo')                                                AS errorInfo,
    JSONExtractString(props, 'originName')                                               AS originName,
    toUInt16OrZero(JSONExtractString(props, 'originStatus'))                             AS originStatus
FROM afd.kafka_raw
ARRAY JOIN recs AS rec
WITH JSONExtractRaw(rec, 'properties') AS props;
