import { create } from 'zustand'
import { loadJSON, saveJSON } from '../lib/storage'
import { CLASSES, SCHOOLS } from '../data/seed'

/**
 * 报告数据聚焦（v0.9.5 P0-B）
 *
 * 报告默认出全区口径；聚焦到某校/某班后，报告追加该范围的学情明细。
 * 现场动作「切下拉 → 报告数字变」就是靠这条通道成立的——它把报告从
 * 一份全区固定快照变成随取数范围变化的文档。
 */
interface DataFocusState {
  /** 学校 id，'' = 全区 */
  schoolId: string
  /** 班级 id，'' = 不聚焦班级 */
  classId: string
  setSchool: (schoolId: string) => void
  setClass: (classId: string) => void
}

interface Persisted {
  schoolId: string
  classId: string
}

const saved = loadJSON<Persisted>('dataFocus', { schoolId: '', classId: '' })

/** 学校 id 是否仍存在（数据演进后旧持久化值不致指向空校） */
function validSchool(id: string): boolean {
  return id === '' || SCHOOLS.some((s) => s.id === id)
}
function validClass(id: string): boolean {
  return id === '' || CLASSES.some((c) => c.id === id)
}

export const useDataFocusStore = create<DataFocusState>((set, get) => ({
  schoolId: validSchool(saved.schoolId) ? saved.schoolId : '',
  classId: validClass(saved.classId) ? saved.classId : '',

  setSchool: (schoolId) => {
    /* 切校时清掉不属于该校的班级聚焦，避免出现「城南中学 · 高一（3）班」这类错配 */
    const keepClass = CLASSES.some((c) => c.schoolId === schoolId && c.id === get().classId)
    const classId = keepClass ? get().classId : ''
    set({ schoolId, classId })
    saveJSON('dataFocus', { schoolId, classId } satisfies Persisted)
  },

  setClass: (classId) => {
    const cls = CLASSES.find((c) => c.id === classId)
    set({ schoolId: cls?.schoolId ?? get().schoolId, classId })
    saveJSON('dataFocus', { schoolId: get().schoolId, classId } satisfies Persisted)
  },
}))
