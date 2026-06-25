-- FrontLens - geo/ASN enrichment dictionaries for the Event Hub ingestion path.
--
-- AFD access logs contain only clientIp. Convert MaxMind GeoLite2 CSVs to
-- ip_trie dictionaries so ingestion can resolve country/city/lat/lon/ASN by IP.
--
-- Prep (offline): from GeoLite2-City-Blocks-IPv4.csv + GeoLite2-City-Locations-en.csv
-- produce afd_geoip.csv with columns: network(cidr), country, countryName, city, lat, lon
-- and from GeoLite2-ASN-Blocks-IPv4.csv produce afd_asn.csv: network, asn, org.
-- Place them where ClickHouse can read (e.g. /var/lib/clickhouse/user_files/).

CREATE DICTIONARY IF NOT EXISTS afd.geoip
(
    network     String,
    country     String,
    countryName String,
    city        String,
    lat         Float32,
    lon         Float32
)
PRIMARY KEY network
SOURCE(FILE(path '/var/lib/clickhouse/user_files/afd_geoip.csv' format 'CSVWithNames'))
LAYOUT(IP_TRIE)
LIFETIME(MIN 86400 MAX 172800);

CREATE DICTIONARY IF NOT EXISTS afd.asn
(
    network String,
    asn     UInt32,
    org     String
)
PRIMARY KEY network
SOURCE(FILE(path '/var/lib/clickhouse/user_files/afd_asn.csv' format 'CSVWithNames'))
LAYOUT(IP_TRIE)
LIFETIME(MIN 86400 MAX 172800);

-- Usage: dictGet('afd.geoip', 'country', tuple(IPv4StringToNum('203.0.113.7')))
