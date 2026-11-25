import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export enum BlueprintSource {
  CHATGPT = 'chatgpt',
  CLAUDE = 'claude',
  MANUAL = 'manual',
  GITHUB = 'github',
  NOTION = 'notion',
}

export enum BlueprintFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export enum BlueprintMode {
  ARCHITECTURE = 'architecture',
  IMPLEMENTATION = 'implementation',
  DEBUGGING = 'debugging',
  REVIEW = 'review',
  STUDY = 'study',
}

export class BlueprintImportOptionsDto {
  @IsOptional()
  @IsBoolean()
  saveToWiki?: boolean = true

  @IsOptional()
  @IsBoolean()
  indexInBrain?: boolean = true

  @IsOptional()
  @IsBoolean()
  updateProjectState?: boolean = true

  @IsOptional()
  @IsBoolean()
  createEvents?: boolean = true

  @IsOptional()
  @IsBoolean()
  generateNextSteps?: boolean = true

  @IsOptional()
  @IsBoolean()
  overwriteWiki?: boolean = false
}

export class ImportBlueprintDto {
  @IsString()
  projectId!: string

  @IsEnum(BlueprintSource)
  source!: BlueprintSource

  @IsString()
  @MaxLength(180)
  title!: string

  @IsString()
  @MinLength(10)
  content!: string

  @IsEnum(BlueprintFormat)
  format!: BlueprintFormat

  @IsOptional()
  @IsEnum(BlueprintMode)
  mode?: BlueprintMode

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BlueprintImportOptionsDto)
  options?: BlueprintImportOptionsDto
}
