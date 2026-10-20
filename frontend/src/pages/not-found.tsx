import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-24">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-4xl font-bold tracking-tight">404</p>
          <p className="text-sm text-muted-foreground">
            This table doesn&apos;t exist. Maybe it moved to another room?
          </p>
          <Button asChild>
            <Link to="/">Back to the lobby</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
