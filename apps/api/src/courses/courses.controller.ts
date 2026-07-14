import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetCourseDisabledDto } from './dto';

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

  @Patch(':id/disabled')
  setDisabled(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetCourseDisabledDto,
  ) {
    return this.service.setDisabled(userId, id, dto.disabled);
  }
}
