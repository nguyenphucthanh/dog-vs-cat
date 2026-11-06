/** Codes carried by ConvexError, so the client can show its own translated message. */
export type GameErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_TOKEN'
  | 'UNKNOWN_GUEST'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_PROGRESS'
  | 'NOT_A_MEMBER'
  | 'NOT_THE_HOST'
  | 'TEAM_EMPTY'
  | 'NOT_EVERYONE_READY'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'INVALID_AIM'
  | 'MATCH_NOT_OVER';
