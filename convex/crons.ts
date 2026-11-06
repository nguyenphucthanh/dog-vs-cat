import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('delete idle rooms', { minutes: 5 }, internal.rooms.cleanupIdle, {});

export default crons;
