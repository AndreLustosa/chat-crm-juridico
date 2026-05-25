import { SetMetadata } from '@nestjs/common';
import type { Capability } from './permissions.constants';

export const REQUIRE_CAPABILITY_KEY = 'require_capability';

/**
 * Exige uma capacidade (area) para acessar a rota. Checado pelo CapabilityGuard
 * usando a matriz efetiva do tenant (padrao + overrides). ADMIN sempre passa.
 * Pode ser usado no metodo ou na classe (controller inteiro).
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, capability);
