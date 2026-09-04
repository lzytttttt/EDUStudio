import type { RoleId, ToolDef } from '../types'
import { TOOLS } from './tools'

/** 工具注册表：Agent 编排按名称取用，角色过滤决定可见工具集 */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  listForRole(role: RoleId): ToolDef[] {
    return [...this.tools.values()].filter((t) => t.roles.includes(role))
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }
}

export const toolRegistry = new ToolRegistry()
TOOLS.forEach((t) => toolRegistry.register(t))
