import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';

const resolveWidgetKey = ({ value, obj }: TransformFnParams): unknown => {
  if (value !== undefined && value !== null) {
    return value;
  }
  if (!obj || typeof obj !== 'object') {
    return value;
  }
  return (obj as Record<string, unknown>).widgetType;
};

export class CreateWidgetInstanceDto {
  @Transform(resolveWidgetKey)
  @IsString()
  widgetKey!: string;

  @IsOptional()
  @IsString()
  widgetType?: string;

  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  tournamentId?: string;

  @IsOptional()
  @IsUUID()
  matchId?: string;
}
