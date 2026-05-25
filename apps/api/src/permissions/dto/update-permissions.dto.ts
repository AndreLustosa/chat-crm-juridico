import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PermissionChangeDto {
  @IsString()
  role!: string;

  @IsString()
  capability!: string;

  @IsBoolean()
  allowed!: boolean;
}

export class UpdatePermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionChangeDto)
  changes!: PermissionChangeDto[];
}
