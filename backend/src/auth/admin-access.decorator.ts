import { SetMetadata } from '@nestjs/common';

export const ADMIN_ACCESS_KEY = 'admin_access';
export type AdminAccess = 'only' | 'allowed';

/** Admin tokens cannot use player routes; only explicitly marked routes admit them. */
export const AdminOnly = () => SetMetadata(ADMIN_ACCESS_KEY, 'only');
export const AdminAllowed = () => SetMetadata(ADMIN_ACCESS_KEY, 'allowed');
