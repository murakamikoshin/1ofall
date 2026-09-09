import { RoomPackSchema, type RoomPack } from './schema';
import corePack from '../../data/rooms.core.json';

/**
 * 部屋データはコードから分離して JSON で持つ。
 * 将来のプレイヤー投稿でも同じ入口を通す（読み込み時に必ず検証する）。
 */
export function loadPack(raw: unknown): RoomPack {
  const result = RoomPackSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`部屋データが不正: ${result.error.issues.map((i) => i.message).join(' / ')}`);
  }
  return result.data;
}

export function corePackage(): RoomPack {
  return loadPack(corePack);
}
