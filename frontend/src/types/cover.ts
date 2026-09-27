/** 实寄封（Cover）数据模型：一封实际寄递过的信封的全部编目事实。 */

/** 品相 */
export type ConditionGrade = '上品' | '中品' | '下品'

/** 贴票构成：票种 + 面值 + 枚数 */
export interface FrankingItem {
  stampName: string
  denomination: number
  count: number
}

/** 结构化藏册格位：册名 + 页码 + 格位，三项齐全才唯一确定一格。 */
export interface StorageSlot {
  albumName: string
  pageNo: number
  slotNo: number
}

/** 一次页位调拨记录：记下调拨前后的格位与日期，旧位置也可追溯。 */
export interface StorageMoveRecord {
  /** 调拨日期 YYYY-MM-DD */
  date: string
  /** 原格位；首次入册时三项为空 */
  fromAlbumName: string
  fromPageNo: number | null
  fromSlotNo: number | null
  /** 新格位 */
  toAlbumName: string
  toPageNo: number
  toSlotNo: number
  /** 调拨事由备注 */
  note: string
}

export interface Cover {
  id?: number
  /** 封号，如 CV-0001 */
  coverNo: string
  sentFrom: string
  sentTo: string
  /** 寄出日期 YYYY-MM-DD */
  postDate: string
  /** 到达日期 YYYY-MM-DD */
  arriveDate: string
  franking: FrankingItem[]
  /** 关联邮戳 id 列表 */
  cancelPmIds: number[]
  /** 所属邮路 id */
  routeId: number | null
  /** 中转地数组 */
  viaPoints: string[]
  /** 是否给据邮件 */
  registered: boolean
  conditionGrade: ConditionGrade
  /** 来源 */
  acquireFrom: string
  /** 购入价（元） */
  price: number
  /** 旧版自由文字页位，不再参与占用，仅保留查看 */
  storageAlbum: string
  /** 当前藏册名；册名/页码/格位三项补全后才参与格位占用 */
  albumName: string
  /** 当前页码 */
  pageNo: number | null
  /** 当前格位（页内第几格） */
  slotNo: number | null
  /** 历次页位调拨记录，按时间先后追加 */
  storageMoves: StorageMoveRecord[]
  /** 封面正面图（缩略 dataURL；原图存 assets 表） */
  frontImage: string
  /** 封面背面图（缩略 dataURL；原图存 assets 表） */
  backImage: string
  note: string
  createdAt: string
  updatedAt: string
}

export const CONDITION_GRADES: ConditionGrade[] = ['上品', '中品', '下品']

/** 生成一条空白实寄封记录，供表单初始化使用。 */
export function createEmptyCover(): Cover {
  return {
    coverNo: '',
    sentFrom: '',
    sentTo: '',
    postDate: '',
    arriveDate: '',
    franking: [],
    cancelPmIds: [],
    routeId: null,
    viaPoints: [],
    registered: false,
    conditionGrade: '中品',
    acquireFrom: '',
    price: 0,
    storageAlbum: '',
    albumName: '',
    pageNo: null,
    slotNo: null,
    storageMoves: [],
    frontImage: '',
    backImage: '',
    note: '',
    createdAt: '',
    updatedAt: ''
  }
}

/* --------------------------- 藏册页位辅助函数 --------------------------- */

/**
 * 把册名/页码/格位规范化为格位；三项未补全（空册名、缺页码或格位）时返回 null，
 * 即「补全三项后才参与占用」。
 */
export function normalizeSlot(
  albumName: unknown,
  pageNo: unknown,
  slotNo: unknown
): StorageSlot | null {
  const album = String(albumName ?? '').trim()
  const page = Number(pageNo)
  const slot = Number(slotNo)
  if (!album || !Number.isFinite(page) || page <= 0 || !Number.isFinite(slot) || slot <= 0) {
    return null
  }
  return { albumName: album, pageNo: Math.trunc(page), slotNo: Math.trunc(slot) }
}

/** 取某封当前所在格位；三项不全返回 null。 */
export function coverSlot(
  cover: Pick<Cover, 'albumName' | 'pageNo' | 'slotNo'>
): StorageSlot | null {
  return normalizeSlot(cover.albumName, cover.pageNo, cover.slotNo)
}

/** 两个格位是否相同（任一为 null 即不同）。 */
export function sameSlot(a: StorageSlot | null, b: StorageSlot | null): boolean {
  return (
    !!a &&
    !!b &&
    a.albumName === b.albumName &&
    a.pageNo === b.pageNo &&
    a.slotNo === b.slotNo
  )
}

/** 格位的中文展示，如「甲册 3 页 2 格」。 */
export function slotLabel(slot: StorageSlot | null | undefined): string {
  return slot ? `${slot.albumName} ${slot.pageNo} 页 ${slot.slotNo} 格` : ''
}

/** 某封当前页位的展示；未入册返回「未入册」。 */
export function coverSlotLabel(cover: Pick<Cover, 'albumName' | 'pageNo' | 'slotNo'>): string {
  return slotLabel(coverSlot(cover)) || '未入册'
}

/** 调拨记录里的原格位（首次入册时为 null）。 */
export function moveFromSlot(move: StorageMoveRecord): StorageSlot | null {
  return normalizeSlot(move.fromAlbumName, move.fromPageNo, move.fromSlotNo)
}

/** 调拨记录里的新格位。 */
export function moveToSlot(move: StorageMoveRecord): StorageSlot | null {
  return normalizeSlot(move.toAlbumName, move.toPageNo, move.toSlotNo)
}

/** 目标格位已被别封占用时抛出，携带占用者封号供界面指出并拦截。 */
export class SlotOccupiedError extends Error {
  slot: StorageSlot
  occupantCoverNo: string

  constructor(slot: StorageSlot, occupantCoverNo: string) {
    super(`格位 ${slotLabel(slot)} 已被 ${occupantCoverNo} 占用`)
    this.name = 'SlotOccupiedError'
    this.slot = slot
    this.occupantCoverNo = occupantCoverNo
  }
}
