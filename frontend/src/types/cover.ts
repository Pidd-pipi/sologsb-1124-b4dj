/** 实寄封（Cover）数据模型：一封实际寄递过的信封的全部编目事实。 */

/** 品相 */
export type ConditionGrade = '上品' | '中品' | '下品'

/** 贴票构成：票种 + 面值 + 枚数 */
export interface FrankingItem {
  stampName: string
  denomination: number
  count: number
}

/** 藏册页位：册名 + 页码 + 格位，三项齐全才参与格位占用。 */
export interface AlbumPosition {
  /** 册名，如 甲册 */
  album: string
  /** 页码 */
  page: number | null
  /** 格位，如 A1 / 上左 */
  slot: string
}

/** 一次页位调拨记录：调拨前后的位置与时间。 */
export interface StorageMove {
  /** 调拨时间 ISO */
  movedAt: string
  /** 调拨前页位；null 表示此前未入册（或三项未补全） */
  from: AlbumPosition | null
  /** 调拨后页位 */
  to: AlbumPosition
}

/** 生成一条空白页位，供调拨表单初始化使用。 */
export function createEmptyPosition(): AlbumPosition {
  return { album: '', page: null, slot: '' }
}

/** 规范化页位输入：去空白、页码取整，非法页码归为 null。 */
export function normalizePosition(pos: AlbumPosition): AlbumPosition {
  const page = pos.page == null ? null : Math.trunc(Number(pos.page))
  return {
    album: String(pos.album ?? '').trim(),
    page: page != null && Number.isFinite(page) && page > 0 ? page : null,
    slot: String(pos.slot ?? '').trim()
  }
}

/** 三项齐全才算有效页位，只有有效页位参与格位占用。 */
export function isCompletePosition(pos: AlbumPosition): boolean {
  return !!pos.album.trim() && pos.page != null && pos.page > 0 && !!pos.slot.trim()
}

/** 两个页位是否指向同一格（按册名 + 页码 + 格位判定）。 */
export function samePosition(a: AlbumPosition, b: AlbumPosition): boolean {
  const na = normalizePosition(a)
  const nb = normalizePosition(b)
  return na.album === nb.album && na.page === nb.page && na.slot === nb.slot
}

/** 页位的展示文本，如「甲册 · 第3页 · A1格」。 */
export function formatPosition(pos: AlbumPosition | null | undefined): string {
  if (!pos || !isCompletePosition(pos)) return '未入册'
  return `${pos.album.trim()} · 第${pos.page}页 · ${pos.slot.trim()}格`
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
  /** 藏册页位（旧自由文字，仅保留查看，不参与占用） */
  storageAlbum: string
  /** 当前册名 */
  storageAlbumName: string
  /** 当前页码 */
  storagePage: number | null
  /** 当前格位 */
  storageSlot: string
  /** 页位调拨记录（调拨前后位置与日期） */
  storageMoves: StorageMove[]
  /** 封面正面图（缩略 dataURL；原图存 assets 表） */
  frontImage: string
  /** 封面背面图（缩略 dataURL；原图存 assets 表） */
  backImage: string
  note: string
  createdAt: string
  updatedAt: string
}

export const CONDITION_GRADES: ConditionGrade[] = ['上品', '中品', '下品']

/** 取封的当前页位（原始三项，可能未补全）。 */
export function coverPosition(cover: Cover): AlbumPosition {
  return normalizePosition({
    album: cover.storageAlbumName ?? '',
    page: cover.storagePage ?? null,
    slot: cover.storageSlot ?? ''
  })
}

/** 封的当前页位展示文本；三项未补全时给出提示，不参与占用。 */
export function positionLabel(cover: Cover): string {
  const pos = coverPosition(cover)
  if (isCompletePosition(pos)) return formatPosition(pos)
  const partial = pos.album !== '' || pos.page != null || pos.slot !== ''
  return partial ? '页位待补全' : '未入册'
}

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
    storageAlbumName: '',
    storagePage: null,
    storageSlot: '',
    storageMoves: [],
    frontImage: '',
    backImage: '',
    note: '',
    createdAt: '',
    updatedAt: ''
  }
}
