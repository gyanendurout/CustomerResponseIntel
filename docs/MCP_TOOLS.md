<!-- GENERATED from src/core/registry.ts by tests/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run tests/docs.test.ts` after changing a capability. -->
# MCP tools

Endpoint: `https://<your-deployment>/api/mcp` (Streamable HTTP). All tools are **read-only**
(`readOnlyHint: true`). Every result has `structuredContent = {data, meta}` (same shape as the REST API) plus a
short text summary with the main caveats from `meta.notes`. Results are kept under ~25 KB; when a list has to be
shortened, `meta.truncated = true` and a note says so.

* **Brand names** are case-insensitive and fuzzy-matched (`joola`, `Selkirk`, `six zero`). Unknown names return an
  error such as *"Unknown brand 'jola' — did you mean JOOLA? Valid brands: …"*.
* **Dates** default to the last 90 days of available data.
* **Common filters:** `from`, `to`, `brands`, `channels`, `sentiments`, `crisis_only`, `granularity`, `include_undated` (see docs/API.md).
* **Spike method (detect_spikes):** for each period, baseline = previous *window* periods (default 8), spike when
  value > mean + k·sd (default k = 2, population sd), at least 4 baseline periods; negative % ignores periods with fewer
  than `min_volume` labelled items.

| Tool | REST twin | Answers |
|---|---|---|
| `list_brands` | `/api/v1/brands` | List brands |
| `channel_overview` | `/api/v1/channels` | Channel overview |
| `volume_over_time` | `/api/v1/volume` | Volume over time |
| `share_of_voice` | `/api/v1/share-of-voice` | Share of voice |
| `sentiment_breakdown` | `/api/v1/sentiment` | Sentiment breakdown |
| `top_complaints` | `/api/v1/complaints` | Top complaints |
| `search_posts` | `/api/v1/posts` | Search posts |
| `crisis_monitor` | `/api/v1/crises` | Crisis monitor |
| `detect_spikes` | `/api/v1/spikes` | Detect spikes |
| `brand_switching` | `/api/v1/switches` | Brand switching |
| `topic_trends` | `/api/v1/topics` | Topic trends |
| `compare_brands` | `/api/v1/compare` | Compare brands |
| `metrics` | `/api/v1/metrics` | Flexible metrics |
| `data_health` | `/api/v1/data-health` | Data health |
| `brand_replies` | `/api/v1/replies` | Brand replies |

## `list_brands`

Lists the 11 tracked brands (JOOLA plus 10 competitors) with ids, names, slugs, is_joola and a chart colour. Use it to discover valid brand names before calling other tools, or to colour charts consistently. Other tools already accept brand names case-insensitively, so you rarely need ids. Output: data = [{brand_id, name, slug, is_joola, is_active, colour:{light, dark, slot, shares_colour}}]. shares_colour=true means the brand has no unique hue (only 8 are colour-blind safe), so fold it into "Other" when charting many brands. Example: "Which competitors do we track?"

**Inputs**

_No parameters beyond the common filters._

**Example calls**

* *Which competitors do we track?* → `{}`

## `channel_overview`

Per normalised channel (instagram, youtube, reddit, tiktok, x, product_review): total items, how many are dated vs undated, how many dates come from the parent post/video (date_from_parent), first and last item date, and the last scrape time. Unlike other tools it covers FULL HISTORY unless from/to are given, because it describes data coverage. Use it to check coverage and freshness before trusting a trend; use data_health for known data problems. Items are counted once even if they mention several brands. Output: data = [{channel, total, dated, undated, date_from_parent, first_date, last_date, last_scrape_at}]. Example: "How fresh is our YouTube data and how much of it has dates?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |

**Example calls**

* *How fresh is each channel and how much of it is dated?* → `{}`
* *JOOLA coverage by channel in August* → `{"brands":["JOOLA"],"from":"2026-08-01","to":"2026-08-31"}`

## `volume_over_time`

Time series of mention volume, split by brand (default), channel, or none, with period-over-period growth % per series. Use for "how many mentions / is volume rising"; use share_of_voice for relative share, metrics for other measures. Split by brand counts one signal per brand mentioned; other splits count each item once. Periods are zero-filled. Output: data.points = [{period (YYYY-MM-DD start), series, value, growth_pct}], data.totals = [{label, value}]. Example: "How did JOOLA mention volume trend month by month since May?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `split_by` | brand \| channel \| none | no | Series dimension. Default brand. |

**Example calls**

* *Monthly JOOLA vs Selkirk mention volume since May* → `{"brands":["JOOLA","Selkirk"],"from":"2026-05-01","granularity":"month"}`
* *Daily volume by channel over the last 30 days* → `{"split_by":"channel","from":"2026-08-30","to":"2026-09-28"}`

## `share_of_voice`

Each brand's percentage of all brand mentions per period, plus the overall share for the whole range. If brands are given, shares are computed among THOSE brands only (they sum to 100%). Use for relative position vs competitors; use volume_over_time for absolute counts. Output: data.points = [{period, series (brand), value (%), count}], data.overall = [{label, value (%), count}]. Example: "What was JOOLA's share of voice vs all competitors each month?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |

**Example calls**

* *JOOLA's monthly share of voice against all competitors* → `{"granularity":"month"}`
* *Share of voice on Reddit only* → `{"channels":["reddit"]}`

## `sentiment_breakdown`

Counts and percentages of the 5 sentiment levels (very_negative … very_positive) and the 3-level rollup (very_* folded into its parent), grouped by brand (default), channel, period, or none. Unlabelled items are counted separately and excluded from percentage denominators. Use for "how negative is X"; use metrics for negative % over time with custom grouping, detect_spikes for anomalies. Output: data.five_level/three_level = [{group, label (level), value (count), pct}], data.groups = [{group, total, labelled, negative_pct, positive_pct}]. Example: "How does JOOLA sentiment compare with Selkirk on Instagram?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `group_by` | brand \| channel \| period \| none | no | Default brand. |

**Example calls**

* *Sentiment by brand over the last 90 days* → `{}`
* *JOOLA sentiment by channel* → `{"brands":["JOOLA"],"group_by":"channel"}`

## `top_complaints`

Top complaint keywords per brand with a monthly trend and 3 example items each. Keywords come from two sources: product-review complaint categories (e.g. delamination, dead_spot, customer_service) and social crisis keywords (the words that triggered a crisis flag); `kinds` says which. Use for "what are people complaining about"; use search_posts to read more items for one keyword. Output: data = [{brand, keyword, count, kinds, trend:[{period, value}], examples:[item]}]. Example: "What are the top complaints about JOOLA paddles this quarter?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `top_n` | integer ≥1, ≤20 | no | Keywords per brand. Default 5. |

**Example calls**

* *Top complaints about JOOLA this quarter* → `{"brands":["JOOLA"]}`
* *Top 3 review complaints per brand* → `{"channels":["product_review"],"top_n":3}`

## `search_posts`

Finds individual posts, comments and reviews, optionally matching a text query (q, case-insensitive substring), with all common filters. Sort by date (newest first, default; undated items only appear with include_undated=true and sort last) or engagement. Cursor-paged: pass meta.page.next_cursor back as `cursor` for the next page. limit ≤ 50; text truncated to 500 chars; @handles are masked. Each item appears once, with all brands it mentions. Use to read real examples or quotes; use the aggregate tools for counts. Output: data.items = [{item_id, channel, signal_type, brands, sentiment_5, sentiment_3, is_crisis, occurred_at, date_source, text, text_truncated, post_url, engagement, engagement_kind}]. Example: "Show the most-liked negative Instagram comments about JOOLA edge guards."

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `q` | string | no | Text to search for (substring, case-insensitive). |
| `sort` | date \| engagement | no | date (default) or engagement. |
| `limit` | integer ≥1, ≤50 | no | Page size, default 20, max 50. |
| `cursor` | string | no | next_cursor from the previous page. |

**Example calls**

* *Most-liked negative JOOLA comments mentioning "edge guard"* → `{"brands":["JOOLA"],"q":"edge guard","sentiments":["negative_all"],"sort":"engagement"}`
* *Latest crisis-flagged product reviews* → `{"channels":["product_review"],"crisis_only":true}`

## `crisis_monitor`

Crisis-flagged items per period (optionally split by brand or channel) plus the 10 most recent DATED crisis items. Undated crisis items are never shown as recent; their count is reported in meta.excluded/notes. Use for "are there any crises / what are the latest"; use detect_spikes for unusual negativity, top_complaints for themes. Output: data.points = [{period, series, value}], data.recent = [item], data.total. Example: "Any JOOLA crises in the last two weeks? Show the latest ones."

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `split_by` | none \| brand \| channel | no | Default none. |

**Example calls**

* *Latest JOOLA crises* → `{"brands":["JOOLA"]}`
* *Weekly crisis count by channel* → `{"split_by":"channel","granularity":"week"}`

## `detect_spikes`

Finds periods where a brand's volume or negative % jumped above its own rolling baseline. Method: for each period, baseline = the previous `window` periods (default 8, the period itself excluded); spike when value > mean + k·sd (default k=2, population sd), needing at least 4 baseline periods. negative_pct ignores periods with fewer than min_volume labelled items (default 10). Default granularity is week. Use for "anything unusual?"; use crisis_monitor for flagged crises. Output: data.spikes = [{brand, period, value, baseline_mean, baseline_sd, z, threshold}], data.series = [{period, series, value, volume}]. Example: "Were there any unusual spikes in negative sentiment for JOOLA this summer?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `metric` | volume \| negative_pct | no | volume (default) or negative_pct. |
| `window` | integer ≥3, ≤26 | no | Baseline periods. Default 8. |
| `k` | number ≥1, ≤5 | no | Std-dev multiplier. Default 2. |
| `min_volume` | integer ≥1, ≤10000 | no | negative_pct only: minimum labelled items per period. Default 10. |

**Example calls**

* *Unusual weekly negative-sentiment spikes for JOOLA since May* → `{"brands":["JOOLA"],"metric":"negative_pct","from":"2026-05-01"}`
* *Volume spikes for any brand* → `{}`

## `brand_switching`

People saying they switched from one brand to another. For a focus brand (default JOOLA): inflow (switched TO it), outflow (switched FROM it), net, a full from→to matrix, a monthly inflow/outflow trend, and data-gap counts. Event date = posted date, else detection date (date_from_detection counts those). Events with an unknown side are shown as "Unknown" in the matrix and counted in gaps; they never silently disappear. Output: data = {focus_brand, inflow, outflow, net, matrix:[{from,to,value}], trend:[{period, series, value}], gaps}. Example: "Are more people switching to JOOLA or away from it, and to whom?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `brand` | string | no | Focus brand (name/slug/id). Default JOOLA. |

**Example calls**

* *Net switching to/from JOOLA* → `{}`
* *Who is Selkirk losing customers to?* → `{"brand":"Selkirk","from":"2026-01-01"}`

## `topic_trends`

Weekly topic volume (from the topic tracker; weeks start Monday) for the top topics, the fastest-growing topics (last week vs the week before, topics with at least 5 mentions the week before), the computed peak week per topic, and JOOLA vs competitor share per topic. Topic data covers 2026 ISO weeks 26 onward only. Use for "what are people talking about / what is rising"; use top_complaints for complaints, metrics(group_by topic) for custom cuts. Output: data = {weekly:[{period, series (topic), value}], fastest_growing:[...], peaks:[...], joola_share:[...]}. Example: "Which topics are growing fastest for JOOLA on Instagram?"

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `top_n` | integer ≥1, ≤25 | no | Number of topics. Default 10. |

**Example calls**

* *Fastest-growing topics overall* → `{}`
* *Top topics for JOOLA on Instagram* → `{"brands":["JOOLA"],"channels":["instagram"],"top_n":5}`

## `compare_brands`

Side-by-side metrics for 2–5 brands over one period: volume, share of voice (vs ALL tracked brands), negative %, positive % (of labelled items), crisis count and top complaint keyword. Use for head-to-head questions; use share_of_voice / volume_over_time for trends over time. Output: data = [{brand, volume, share_of_voice_pct, negative_pct, positive_pct, crisis_count, top_complaint:{keyword,count}|null}]. Example: "Compare JOOLA, Selkirk and CRBN over the last 90 days."

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | yes | 2–5 brands to compare (names, slugs or ids). |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |

**Example calls**

* *Compare JOOLA, Selkirk and CRBN* → `{"brands":["JOOLA","Selkirk","CRBN"]}`
* *JOOLA vs Six Zero on Reddit since June* → `{"brands":["JOOLA","Six Zero"],"channels":["reddit"],"from":"2026-06-01"}`

## `metrics`

The flexible tool for questions no other tool covers. Pick ONE measure (count, negative_pct, positive_pct, crisis_count, avg_engagement, total_engagement) and 1–2 group_by dimensions (period, brand, channel, sentiment_5, sentiment_3, signal_type, topic), plus any common filters. Whitelisted only; there is no free SQL. negative_pct/positive_pct use labelled items as the denominator. group_by topic reads the weekly topic tracker and supports only measure=count with period/brand/channel. Results are capped at 500 groups (meta.notes says when). Output: data.rows = [{<dim>: value, ..., value, n}] (n = items in the group); data.points = [{period, series, value}] when period is a dimension. Example: "Weekly negative % for JOOLA vs Selkirk on Reddit since May" → measure=negative_pct, group_by=[period, brand], granularity=week, brands=[JOOLA, Selkirk], channels=[reddit], from=2026-05-01.

**Inputs**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string (date) | no | Start date, inclusive (YYYY-MM-DD). Default: 89 days before `to`. |
| `to` | string (date) | no | End date, inclusive (YYYY-MM-DD). Default: the newest date in the data (not today). |
| `brands` | list of string | no | Brand names, slugs or ids, case-insensitive (e.g. ["JOOLA","Selkirk"]). Default: all brands. |
| `channels` | list of instagram \| youtube \| reddit \| tiktok \| x \| product_review \| other | no | Normalised channels. product_review is its own channel. Default: all. |
| `sentiments` | list of very_negative \| negative \| neutral \| positive \| very_positive \| unlabelled \| negative_all \| positive_all | no | 5-level values (very_negative … very_positive, unlabelled) or 3-level groups negative_all / positive_all. |
| `crisis_only` | boolean | no | Only signals flagged as crisis. Default false. |
| `granularity` | day \| week \| month | no | Time bucket. Default: month if the range is over 60 days, else day. |
| `include_undated` | boolean | no | Include signals with no date in totals (never placed in a time period). Default false. |
| `measure` | count \| negative_pct \| positive_pct \| crisis_count \| avg_engagement \| total_engagement | yes | What to compute. |
| `group_by` | list of period \| brand \| channel \| sentiment_5 \| sentiment_3 \| signal_type \| topic | yes | 1–2 dimensions. |

**Example calls**

* *Weekly negative % for JOOLA vs Selkirk on Reddit since May* → `{"measure":"negative_pct","group_by":["period","brand"],"granularity":"week","brands":["JOOLA","Selkirk"],"channels":["reddit"],"from":"2026-05-01"}`
* *Average engagement by channel and signal type* → `{"measure":"avg_engagement","group_by":["channel","signal_type"]}`

## `data_health`

Data-quality report: per source table rows, null dates, null brands, date range and last load; last scrape per channel; and a checklist of known data issues with LIVE counts (undated YouTube comments, unbranded Reddit comments, mention_facts duplicates, switch-event gaps, undated crises, product reviews as own channel, unlabelled sentiment, reply-detector coverage). Use before drawing conclusions, or when a number looks odd. Takes no filters. Output: data = {tables:[...], channels:[{channel, last_scrape_at, items}], known_issues:[{id, title, status, live_count, detail}]}. Example: "Can I trust the YouTube numbers? What data problems should I know about?"

**Inputs**

_No parameters beyond the common filters._

**Example calls**

* *What data problems should I know about?* → `{}`

## `brand_replies`

How often and how fast brands reply to comments. Returns insufficient_data=true while fewer than 30 replies exist (currently the reply detector has captured very few, all with 0-minute response times), in which case treat the statistics as unreliable and say so. Output: data = {insufficient_data, total_replies, by_brand:[{brand, replies, median_response_mins, avg_response_mins}], first_reply_at, last_reply_at, sample:[...]}. Example: "How quickly does JOOLA reply to comments?"

**Inputs**

_No parameters beyond the common filters._

**Example calls**

* *How quickly does JOOLA reply to comments?* → `{}`
