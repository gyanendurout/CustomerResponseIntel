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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCapability = Capability<any, any>;

export const CAPABILITIES: readonly AnyCapability[] = [
  listBrands, channelOverview, volumeOverTime, shareOfVoice, sentimentBreakdown, topComplaints, searchPosts,
  crisisMonitor, detectSpikes, brandSwitching, topicTrends, compareBrands, metrics, dataHealth, brandReplies,
];

const byRoute = new Map(CAPABILITIES.map(c => [c.route, c]));

export const capabilityByRoute = (route: string) => byRoute.get(route);
