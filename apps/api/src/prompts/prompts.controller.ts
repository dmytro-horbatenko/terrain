import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetSuspendedDto } from './dto';

@Controller('topics')
export class PromptsController {
  constructor(private service: PromptsService) {}

  @Get(':id/prompts/next')
  next(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.next(userId, id);
  }
}

@Controller('prompts')
export class PromptController {
  constructor(private service: PromptsService) {}

  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.getOne(userId, id);
  }

  @Patch(':id')
  setSuspended(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetSuspendedDto,
  ) {
    return this.service.setSuspended(userId, id, dto.suspended);
  }

  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
