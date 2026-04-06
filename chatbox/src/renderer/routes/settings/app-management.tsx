import { Badge, Box, Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconCheck, IconLoader2, IconX } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/chatbridge/api-client'

export const Route = createFileRoute('/settings/app-management')({
  component: RouteComponent,
})

interface AppInfo {
  id: string
  name: string
  description: string | null
  type: string
  authType: string
  enabled: boolean
  reviewStatus: string
}

async function fetchApps(): Promise<AppInfo[]> {
  const res = await apiFetch('/api/apps')
  if (!res.ok) throw new Error('Failed to fetch apps')
  return res.json()
}

async function updateReviewStatus(appId: string, status: string): Promise<void> {
  const res = await apiFetch(`/api/apps/${appId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error('Failed to update review status')
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'green',
  pending: 'yellow',
  rejected: 'red',
}

const TYPE_LABELS: Record<string, string> = {
  iframe: 'Iframe App',
  mcp: 'MCP Server',
  rest: 'REST API',
}

export function RouteComponent() {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  const loadApps = useCallback(async () => {
    try {
      const data = await fetchApps()
      setApps(data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  const handleStatusChange = useCallback(
    async (appId: string, status: string) => {
      setUpdating(appId)
      try {
        await updateReviewStatus(appId, status)
        await loadApps()
      } catch {
        /* ignore */
      } finally {
        setUpdating(null)
      }
    },
    [loadApps]
  )

  if (loading) {
    return (
      <Stack p="md" gap="xl" align="center" justify="center" h="100%">
        <IconLoader2 size={24} className="animate-spin" style={{ color: 'var(--chatbox-tint-tertiary)' }} />
      </Stack>
    )
  }

  return (
    <Stack p="md" gap="xl">
      <Stack gap={4}>
        <Title order={5}>App Management</Title>
        <Text size="sm" c="dimmed">
          Review and manage registered third-party apps. Only approved apps are available to students in the chat.
        </Text>
      </Stack>

      {apps.map((app) => (
        <Box
          key={app.id}
          p="md"
          style={{
            border: '1px solid var(--chatbox-border-primary, #e0e0e0)',
            borderRadius: 8,
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={4} style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={600} size="sm">
                  {app.name}
                </Text>
                <Badge size="xs" variant="light" color="blue">
                  {TYPE_LABELS[app.type] || app.type}
                </Badge>
                <Badge size="xs" variant="light" color={STATUS_COLORS[app.reviewStatus] || 'gray'}>
                  {app.reviewStatus}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {app.description || 'No description'}
              </Text>
              <Text size="xs" c="dimmed">
                Auth: {app.authType} | Enabled: {app.enabled ? 'Yes' : 'No'}
              </Text>
            </Stack>

            <Group gap={6}>
              {app.reviewStatus !== 'approved' && (
                <Button
                  size="xs"
                  variant="light"
                  color="green"
                  leftSection={
                    updating === app.id ? <IconLoader2 size={14} className="animate-spin" /> : <IconCheck size={14} />
                  }
                  onClick={() => handleStatusChange(app.id, 'approved')}
                  disabled={updating !== null}
                >
                  Approve
                </Button>
              )}
              {app.reviewStatus !== 'rejected' && (
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={
                    updating === app.id ? <IconLoader2 size={14} className="animate-spin" /> : <IconX size={14} />
                  }
                  onClick={() => handleStatusChange(app.id, 'rejected')}
                  disabled={updating !== null}
                >
                  Reject
                </Button>
              )}
            </Group>
          </Group>
        </Box>
      ))}

      {apps.length === 0 && (
        <Text size="sm" c="dimmed" ta="center">
          No apps registered.
        </Text>
      )}
    </Stack>
  )
}
