import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import {
  SlotOccupiedError,
  coverSlot,
  normalizeSlot,
  sameSlot,
  type Cover,
  type FrankingItem,
  type StorageSlot
} from '@/types/cover'
import type { StamplessEntry } from '@/types/stampentry'
import { nextSerialNo, nowIso } from '@/utils/id'
import type { ImagePayload } from './postmarkStore'

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

  /**
   * 查找占用指定格位的封（基于各封当前册名/页码/格位实时派生，旧格在调拨后立即释放）。
   * excludeId 用于调拨时排除被调拨封自身。
   */
  function findOccupant(slot: StorageSlot, excludeId?: number): Cover | null {
    return (
      list.value.find((c) => {
        if (excludeId != null && c.id === excludeId) return false
        return sameSlot(coverSlot(c), slot)
      }) ?? null
    )
  }

  async function create(
    input: Cover,
    images?: Partial<Record<'front' | 'back', ImagePayload>>
  ): Promise<number> {
    const now = nowIso()
    const slot = normalizeSlot(input.albumName, input.pageNo, input.slotNo)
    const record: Cover = {
      ...input,
      coverNo: input.coverNo || nextCoverNo(),
      franking: input.franking.map((f) => ({ ...f })),
      cancelPmIds: [...input.cancelPmIds],
      viaPoints: [...input.viaPoints],
      albumName: slot?.albumName ?? String(input.albumName ?? '').trim(),
      pageNo: slot?.pageNo ?? null,
      slotNo: slot?.slotNo ?? null,
      storageMoves: Array.isArray(input.storageMoves) ? input.storageMoves : [],
      createdAt: now,
      updatedAt: now
    }
    delete record.id
    const id = await db.transaction('rw', db.covers, async () => {
      // 三项补全才参与占用：目标格已有别封则在事务内指出封号并回滚拦住
      if (slot) {
        const occupant = await db.covers
          .where({ albumName: slot.albumName, pageNo: slot.pageNo, slotNo: slot.slotNo })
          .first()
        if (occupant) throw new SlotOccupiedError(slot, occupant.coverNo)
      }
      return db.covers.add(record)
    })
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

  /**
   * 调拨页位：目标格三项补全后才参与占用；被别封占用则抛 SlotOccupiedError（含其封号）并回滚；
   * 成功后当前位置更新为新格、旧格立即释放，并追加一条带前后位置与日期的调拨记录。
   * movedAt 为调拨日期 YYYY-MM-DD；fromText 记录旧自由文字（首次补全三项时留痕）。
   */
  async function allocateSlot(
    coverId: number,
    target: { albumName: string; pageNo: number; slotNo: number },
    movedAt: string,
    note = '',
    fromText?: string
  ): Promise<void> {
    const slot = normalizeSlot(target.albumName, target.pageNo, target.slotNo)
    if (!slot) throw new Error('请补全册名、页码与格位三项')
    await db.transaction('rw', db.covers, async () => {
      const current = await db.covers.get(coverId)
      if (!current) throw new Error('未找到该实寄封')
      const from = coverSlot(current)
      if (sameSlot(from, slot)) throw new Error('新格位与当前格位相同，无需调拨')
      const occupant = await db.covers
        .where({ albumName: slot.albumName, pageNo: slot.pageNo, slotNo: slot.slotNo })
        .first()
      if (occupant && occupant.id !== coverId) {
        throw new SlotOccupiedError(slot, occupant.coverNo)
      }
      const moves = Array.isArray(current.storageMoves) ? [...current.storageMoves] : []
      const legacyText = (fromText ?? current.storageAlbum ?? '').trim()
      const autoNote = from
        ? ''
        : legacyText
          ? `首次补全页位三项（旧文字记录：${legacyText}）`
          : '首次补全页位三项'
      moves.push({
        date: movedAt,
        fromAlbumName: from?.albumName ?? '',
        fromPageNo: from?.pageNo ?? null,
        fromSlotNo: from?.slotNo ?? null,
        toAlbumName: slot.albumName,
        toPageNo: slot.pageNo,
        toSlotNo: slot.slotNo,
        note: note.trim() || autoNote
      })
      await db.covers.update(coverId, {
        albumName: slot.albumName,
        pageNo: slot.pageNo,
        slotNo: slot.slotNo,
        storageMoves: moves,
        updatedAt: nowIso()
      })
    })
    await load()
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
    load,
    nextCoverNo,
    create,
    update,
    remove,
    addEntry,
    removeEntry,
    byId,
    entriesOf,
    frankingCount,
    cancelCount,
    findOccupant,
    allocateSlot
  }
})
