import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { BlueprintMode } from './import-blueprint.dto'

export class CreateBlueprintPlanDto {
  @IsOptional()
  @IsString()
  projectId?: string

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  feature!: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  context?: string

  @IsOptional()
  @IsEnum(BlueprintMode)
  mode?: BlueprintMode
}

export interface BlueprintPlanResult {
  title: string
  markdown: string
  estimatedSections: number
  estimatedTasks: number
}
