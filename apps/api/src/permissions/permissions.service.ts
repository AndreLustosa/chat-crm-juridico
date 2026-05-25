import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CAPABILITIES,
  Capability,
  DEFAULT_MATRIX,
  EDITABLE_ROLES,
  EditableRole,
  isCapability,
  isEditableRole,
  normalizeRole,
} from './permissions.constants';

type Matrix = Record<EditableRole, Record<Capability, boolean>>;

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Matriz efetiva do tenant (padrao + overrides) para os papeis editaveis. */
  async getEffectiveMatrix(tenantId: string): Promise<Matrix> {
    const overrides = tenantId
      ? await this.prisma.tenantRolePermission.findMany({ where: { tenant_id: tenantId } })
      : [];
    const ovMap = new Map<string, boolean>(); // `${role}:${cap}` -> allowed
    for (const o of overrides) ovMap.set(`${o.role}:${o.capability}`, o.allowed);

    const matrix = {} as Matrix;
    for (const role of EDITABLE_ROLES) {
      const def = new Set(DEFAULT_MATRIX[role]);
      matrix[role] = {} as Record<Capability, boolean>;
      for (const cap of CAPABILITIES) {
        const ov = ovMap.get(`${role}:${cap}`);
        matrix[role][cap] = ov !== undefined ? ov : def.has(cap);
      }
    }
    return matrix;
  }

  /**
   * Capacidades EFETIVAS de um usuario (uniao dos papeis dele, com overrides).
   * ADMIN -> todas. OPERADOR normaliza para COMERCIAL.
   */
  async getUserCapabilities(tenantId: string, roles: string[] | undefined): Promise<Set<Capability>> {
    const norm = (roles ?? []).map(normalizeRole).filter((r): r is EditableRole | 'ADMIN' => r !== null);
    if (norm.includes('ADMIN')) return new Set(CAPABILITIES); // ADMIN tem tudo
    const editable = norm.filter((r): r is EditableRole => r !== 'ADMIN');
    if (editable.length === 0) return new Set();
    const matrix = await this.getEffectiveMatrix(tenantId);
    const caps = new Set<Capability>();
    for (const role of editable) {
      for (const cap of CAPABILITIES) if (matrix[role][cap]) caps.add(cap);
    }
    return caps;
  }

  /** Grava overrides (admin). Cada item: { role, capability, allowed }. */
  async setOverrides(
    tenantId: string,
    changes: { role: string; capability: string; allowed: boolean }[],
  ): Promise<Matrix> {
    if (!tenantId) throw new BadRequestException('Tenant nao identificado.');
    for (const c of changes) {
      if (!isEditableRole(c.role)) {
        throw new BadRequestException(`Papel invalido para permissoes: ${c.role} (ADMIN nao e editavel).`);
      }
      if (!isCapability(c.capability)) {
        throw new BadRequestException(`Capacidade invalida: ${c.capability}.`);
      }
    }
    for (const c of changes) {
      const isDefault = new Set(DEFAULT_MATRIX[c.role as EditableRole]).has(c.capability as Capability) === c.allowed;
      if (isDefault) {
        // Igual ao padrao -> remove o override (mantem a tabela enxuta).
        await this.prisma.tenantRolePermission.deleteMany({
          where: { tenant_id: tenantId, role: c.role, capability: c.capability },
        });
      } else {
        await this.prisma.tenantRolePermission.upsert({
          where: { tenant_id_role_capability: { tenant_id: tenantId, role: c.role, capability: c.capability } },
          create: { tenant_id: tenantId, role: c.role, capability: c.capability, allowed: c.allowed },
          update: { allowed: c.allowed },
        });
      }
    }
    return this.getEffectiveMatrix(tenantId);
  }
}
