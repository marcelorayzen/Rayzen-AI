import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { BlueprintFormat } from './import-blueprint.dto'

export class PreviewBlueprintDto {
  @IsOptional()
  @IsString()
  projectId?: string

  @IsString()
  title!: string

  @IsString()
  @MinLength(10)
  content!: string

  @IsEnum(BlueprintFormat)
  format!: BlueprintFormat
}
