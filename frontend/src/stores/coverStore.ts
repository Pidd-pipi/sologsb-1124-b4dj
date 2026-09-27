import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import type { AlbumPosition, Cover, FrankingItem, StorageMove } from '@/types/cover'
import { coverPosition, isCompletePosition, normalizePosition, samePosition } from '@/types/cover'
import type { StamplessEntry } from '@/types/stampentry'
import { nextSerialNo, nowIso } from '@/utils/id'
import type { ImagePayload } from './postmarkStore'

/** 页位调拨结果：冲突时带回占用者封号，由页面提示并拦住。 */
export type MoveResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'incomplete' | 'same' | 'conflict'; conflictNo?: string }

export const useCoverStore = defineStore('cover', () => {
  const list = ref<Cover[]>([])
  const entries = ref<StamplessEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.covers.orderBy('coverNo').toArray()
      entries.value = await db.stampEntries.toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 生成下一个封号，如 CV-0005 */
  function nextCoverNo(): string {
    return nextSerialNo('CV-', list.value.map((c) => c.coverNo))
  }

  async function create(
    input: Cover,
    images?: Partial<Record<'front' | 'back', ImagePayload>>
  ): Promise<number> {
    const now = nowIso()
    const pos = normalizePosition(coverPosition(input))
    const record: Cover = {
      ...input,
      coverNo: input.coverNo || nextCoverNo(),
      franking: input.franking.map((f) => ({ ...f })),
      cancelPmIds: [...input.cancelPmIds],
      viaPoints: [...input.viaPoints],
      storageAlbumName: pos.album,
      storagePage: pos.page,
      storageSlot: pos.slot,
      storageMoves: Array.isArray(input.storageMoves) ? [...input.storageMoves] : [],
      createdAt: now,
      updatedAt: now
    }
    delete record.id
    const id = await db.covers.add(record)
    for (const side of ['front', 'back'] as const) {
      const payload = images?.[side]
      if (payload && payload.dataUrl) {
        await saveAsset({
          ownerType: 'cover',
          ownerId: id,
          side,
          dataUrl: payload.dataUrl,
          fileName: payload.fileName,
          updatedAt: now
        })
      }
    }
    await load()
    return id
  }

  async function update(id: number, patch: Partial<Cover>): Promise<void> {
    await db.covers.update(id, { ...patch, updatedAt: nowIso() })
    await load()
  }

  async function remove(id: number): Promise<void> {
    await db.covers.delete(id)
    const own = await db.stampEntries.where('coverId').equals(id).toArray()
    await db.stampEntries.bulkDelete(own.map((e) => e.id).filter((v): v is number => typeof v === 'number'))
    await load()
  }

  async function addEntry(input: StamplessEntry): Promise<number> {
    const id = await db.stampEntries.add({ ...input, createdAt: nowIso() })
    await load()
    return id
  }

  async function removeEntry(id: number): Promise<void> {
    await db.stampEntries.delete(id)
    await load()
  }

  function byId(id: number | null | undefined): Cover | null {
    if (id == null) return null
    return list.value.find((c) => c.id === id) ?? null
  }

  /** 某个封下的票戳组合明细 */
  function entriesOf(coverId: number | null | undefined): StamplessEntry[] {
    if (coverId == null) return []
    return entries.value.filter((e) => e.coverId === coverId)
  }

  /** 贴票枚数（行内展示用） */
  function frankingCount(cover: Cover | null): number {
    if (!cover) return 0
    return cover.franking.reduce((sum, f: FrankingItem) => sum + (Number(f.count) || 0), 0)
  }

  /** 关联邮戳数（行内展示用） */
  function cancelCount(cover: Cover | null): number {
    return cover ? cover.cancelPmIds.length : 0
  }

  /** 占用某页位的封（排除 excludeId）；只有三项齐全的封才参与占用。 */
  function occupantAt(pos: AlbumPosition, excludeId?: number | null): Cover | null {
    const target = normalizePosition(pos)
    if (!isCompletePosition(target)) return null
    return (
      list.value.find((c) => {
        if (c.id === excludeId) return false
        const cur = coverPosition(c)
        return isCompletePosition(cur) && samePosition(cur, target)
      }) ?? null
    )
  }

  /**
   * 页位调拨：目标格已被别封占用时报占用者封号并拦住；
   * 调拨成功后旧格随字段更新立刻释放，并记下前后位置与时间。
   */
  async function moveStorage(id: number, target: AlbumPosition): Promise<MoveResult> {
    const cover = byId(id)
    if (!cover) return { ok: false, reason: 'missing' }
    const to = normalizePosition(target)
    if (!isCompletePosition(to)) return { ok: false, reason: 'incomplete' }
    const from = coverPosition(cover)
    const fromComplete = isCompletePosition(from)
    if (fromComplete && samePosition(from, to)) return { ok: false, reason: 'same' }
    const occupant = occupantAt(to, id)
    if (occupant) return { ok: false, reason: 'conflict', conflictNo: occupant.coverNo }
    const move: StorageMove = { movedAt: nowIso(), from: fromComplete ? from : null, to }
    await db.covers.update(id, {
      storageAlbumName: to.album,
      storagePage: to.page,
      storageSlot: to.slot,
      storageMoves: [...(cover.storageMoves ?? []), move],
      updatedAt: nowIso()
    })
    await load()
    return { ok: true }
  }

  /** 已使用的册名列表（筛选用） */
  const albumNames = computed<string[]>(() => {
    const names = new Set<string>()
    for (const c of list.value) {
      const name = (c.storageAlbumName ?? '').trim()
      if (name) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  })

  const coversOfRoute = computed(() => {
    return (routeId: number): Cover[] => list.value.filter((c) => c.routeId === routeId)
  })

  const total = computed(() => list.value.length)
  const registeredCount = computed(() => list.value.filter((c) => c.registered).length)

  return {
    list,
    entries,
    loading,
    loaded,
    total,
    registeredCount,
    coversOfRoute,
    albumNames,
    load,
    nextCoverNo,
    create,
    update,
    remove,
    moveStorage,
    occupantAt,
    addEntry,
    removeEntry,
    byId,
    entriesOf,
    frankingCount,
    cancelCount
  }
})
