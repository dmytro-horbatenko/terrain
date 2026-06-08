import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ImportService } from './import.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('sessions/import')
export class ImportController {
  constructor(private service: ImportService) {}

  @Post('preview')
  @HttpCode(200)
  preview(@CurrentUser() userId: string, @Body('raw') raw: string) {
    return this.service.preview(userId, raw);
  }

  @Post()
  @HttpCode(200)
  apply(@CurrentUser() userId: string, @Body('raw') raw: string) {
    return this.service.apply(userId, raw);
  }
}
