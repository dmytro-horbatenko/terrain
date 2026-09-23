import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private service: ProjectsService) {}

  @Get('progress')
  list(@CurrentUser() userId: string) {
    return this.service.list(userId);
  }

  @Post('checkpoints')
  save(@CurrentUser() userId: string, @Body() input: unknown) {
    return this.service.save(userId, input);
  }
}
