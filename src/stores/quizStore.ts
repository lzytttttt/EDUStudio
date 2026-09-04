import { create } from 'zustand'
import { loadJSON, saveJSON } from '../lib/storage'

/** 试题条目（v0.3 专项 ①：教师出题工作台） */
export interface QuizItem {
  id: string
  type: 'single' | 'blank' | 'solve'
  stem: string
  /** 单选题选项（A-D） */
  options?: string[]
  answer: string
  analysis: string
  /** 难度系数 0-1 */
  difficulty: number
  knowledgePoint: string
}

export const QUIZ_TYPE_LABEL: Record<QuizItem['type'], string> = {
  single: '单选',
  blank: '填空',
  solve: '解答',
}

interface QuizState {
  items: QuizItem[]
  /** 本次命题的知识点 */
  knowledgePoint: string
  setItems: (knowledgePoint: string, items: QuizItem[]) => void
  updateItem: (id: string, patch: Partial<QuizItem>) => void
  removeItem: (id: string) => void
  addItem: (type?: QuizItem['type']) => void
  clear: () => void
}

const persisted = loadJSON<{ items: QuizItem[]; knowledgePoint: string }>('quiz', { items: [], knowledgePoint: '' })

function genId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export const useQuizStore = create<QuizState>((set, get) => ({
  items: persisted.items,
  knowledgePoint: persisted.knowledgePoint,
  setItems: (knowledgePoint, items) => {
    set({ knowledgePoint, items })
    saveJSON('quiz', { items, knowledgePoint })
  },
  updateItem: (id, patch) => {
    const items = get().items.map((it) => (it.id === id ? { ...it, ...patch } : it))
    set({ items })
    saveJSON('quiz', { items, knowledgePoint: get().knowledgePoint })
  },
  removeItem: (id) => {
    const items = get().items.filter((it) => it.id !== id)
    set({ items })
    saveJSON('quiz', { items, knowledgePoint: get().knowledgePoint })
  },
  addItem: (type = 'blank') => {
    const item: QuizItem = {
      id: genId(),
      type,
      stem: '',
      options: type === 'single' ? ['选项 A', '选项 B', '选项 C', '选项 D'] : undefined,
      answer: '',
      analysis: '',
      difficulty: 0.65,
      knowledgePoint: get().knowledgePoint,
    }
    const items = [...get().items, item]
    set({ items })
    saveJSON('quiz', { items, knowledgePoint: get().knowledgePoint })
  },
  clear: () => {
    set({ items: [], knowledgePoint: '' })
    saveJSON('quiz', { items: [], knowledgePoint: '' })
  },
}))
