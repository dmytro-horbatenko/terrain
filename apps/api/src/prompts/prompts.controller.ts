import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetGraduatedDto } from './dto';

@Controller('topics')
export class PromptsController {
  constructor(private service: PromptsService) {}

  @Get(':id/prompts/next')
  next(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.next(userId, id);
  }
}

@Controller('prompts')
export class PromptGraduationController {
  constructor(private service: PromptsService) {}

  @Patch(':id')
  setGraduated(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetGraduatedDto,
  ) {
    return this.service.setGraduated(userId, id, dto.graduated);
  }
}
