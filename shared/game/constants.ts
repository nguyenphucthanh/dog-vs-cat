// Every gameplay number lives here so playtest tuning touches one file.
// Units: blocks, seconds unless suffixed with _MS.

// Map
export const MAP_SIZE = 64;
export const MAP_HEIGHT = 24;
export const WATER_LEVEL = 4; // Highest block row that counts as sea.
export const WATER_SURFACE = WATER_LEVEL + 1; // Height of the water plane.
export const BEDROCK_LAYERS = 2;
export const SPAWN_MIN_DISTANCE = 6;

// Room and turns
export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O or 1/I.
export const ROOM_IDLE_MS = 30 * 60 * 1000;
export const PRESENCE_INTERVAL_MS = 10_000;
export const MAX_TURNS = 200;
export const MAX_MISSED_TURNS = 3;
export const TURN_MS = 30_000;
export const OFFLINE_TURN_MS = 5_000;
export const RETREAT_MS = 4_000;
export const EXPLOSION_PAUSE_MS = 2_500; // Long enough to watch people get knocked around.
export const POSE_INTERVAL_MS = 200;
export const POSE_SPEED_SLACK = 1.5; // Margin for network timing when checking reported movement.
export const POSE_DISTANCE_SLACK = 1;
export const POSE_MAX_RISE_SPEED = 12;
export const POSE_RISE_SLACK = 2;
export const SPAWN_PITCH = 0.15;

// Player
export const MAX_HP = 100;
export const WALK_SPEED = 2.5;
export const JUMP_HEIGHT = 1.5;
export const STEP_HOP_HEIGHT = 1.15; // The automatic hop onto a one-block ledge.
export const PLAYER_WIDTH = 0.8;
export const PLAYER_HEIGHT = 1.8;
export const GRAVITY = 20;
export const MAX_FALL_SPEED = 40;
export const GROUND_FRICTION = 0.8; // Knockback speed kept per sim step on the ground.
export const SAFE_FALL = 4;
export const FALL_DAMAGE_PER_BLOCK = 5;

// Bazooka
export const PROJECTILE_SPEED = 40;
export const SHOT_TIME_SCALE = 0.5; // Below 1, shots take longer on the same path. Aiming and range don't change.
export const MIN_POWER = 0.15;
export const CHARGE_MS = 2_000;
export const POWER_TOLERANCE = 0.25; // Network slack when validating a client's power.
export const MAX_FLIGHT_MS = 10_000;
export const FLIGHT_MARGIN = 32; // How far past the map edge a shot stays alive.
export const SHOOTER_IMMUNE_MS = 200; // Lets a shot leave the barrel. Before SHOT_TIME_SCALE stretches it.
export const MUZZLE_HEIGHT = 1.4;
export const MUZZLE_REACH = 0.9;
export const MAX_PITCH = 1.4;

// Explosion
export const EXPLOSION_DAMAGE = 50;
export const EXPLOSION_RADIUS = 4;
export const CRATER_RADIUS = 3;
export const KNOCKBACK_SPEED = 12;

// Wind (acceleration on the projectile)
export const WIND_MAX = 4;
export const WIND_MAX_CHANGE = 1.5;

// Simulation
export const SIM_DT = 1 / 60;
export const MAX_SETTLE_MS = 15_000;
