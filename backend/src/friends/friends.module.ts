import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { Friendship } from './friendship.entity.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Friendship, User])],
  controllers: [FriendsController],
  providers: [FriendsService],
  // The tables module checks "invite friends only" against this service.
  exports: [FriendsService],
})
export class FriendsModule {}
