import { Controller, Get, Param, Post } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('courses')
export class CoursesController {
  constructor(private service: CoursesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.service.list(userId);
  }

  @Post(':id/import')
  import(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.importCourse(userId, id);
  }
}
