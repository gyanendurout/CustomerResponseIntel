// The capability registry: the single list that REST routes, MCP tools, OpenAPI and docs are generated from.
// To add a capability: create src/core/capabilities/<name>.ts and add it here.
import type { Capability } from './capability';
import { listBrands } from './capabilities/list-brands';
import { channelOverview } from './capabilities/channel-overview';
import { volumeOverTime } from './capabilities/volume';
import { shareOfVoice } from './capabilities/share-of-voice';
import { sentimentBreakdown } from './capabilities/sentiment';
import { topComplaints } from './capabilities/complaints';
import { searchPosts } from './capabilities/search-posts';
import { crisisMonitor } from './capabilities/crises';
import { detectSpikes } from './capabilities/spikes';
import { brandSwitching } from './capabilities/switches';
import { topicTrends } from './capabilities/topics';
import { compareBrands } from './capabilities/compare';
import { metrics } from './capabilities/metrics';
import { dataHealth } from './capabilities/data-health';
import { brandReplies } from './capabilities/replies';
import { audienceGrowth } from './capabilities/audience';
import { contentPerformance } from './capabilities/content';
import { topContent } from './capabilities/top-content';
import { postingCadence } from './capabilities/cadence';
import { videoInsights } from './capabilities/video-insights';
import { redditInsights } from './capabilities/reddit-insights';
import { productMentions } from './capabilities/product-mentions';
import { athleteMentions } from './capabilities/athlete-mentions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCapability = Capability<any, any>;

export const CAPABILITIES: readonly AnyCapability[] = [
  listBrands, channelOverview, volumeOverTime, shareOfVoice, sentimentBreakdown, topComplaints, searchPosts,
  crisisMonitor, detectSpikes, brandSwitching, topicTrends, compareBrands, metrics, dataHealth, brandReplies,
  audienceGrowth, contentPerformance, topContent, postingCadence, videoInsights, redditInsights, productMentions, athleteMentions,
];

const byRoute = new Map(CAPABILITIES.map(c => [c.route, c]));

export const capabilityByRoute = (route: string) => byRoute.get(route);
