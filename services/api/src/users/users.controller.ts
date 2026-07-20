import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, User } from '@gachinol/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUserDto, UpdateUserDto, UserListQueryDto } from './schemas/user.schemas';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin', 'center_operator')
  @ApiOperation({ summary: '사용자 목록 (관제·관리)' })
  list(@Query() query: UserListQueryDto): Promise<Paginated<User>> {
    return this.users.list(query);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: '계정 생성 — 관리자 전용 (셀프 가입 아님)' })
  create(@Body() body: CreateUserDto): Promise<User> {
    return this.users.create(body);
  }

  @Get(':id')
  @Roles('admin', 'center_operator')
  @ApiOperation({ summary: '사용자 단건 조회' })
  get(@Param('id') id: string): Promise<User> {
    return this.users.get(id);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '사용자 수정' })
  update(@Param('id') id: string, @Body() body: UpdateUserDto): Promise<User> {
    return this.users.update(id, body);
  }
}
