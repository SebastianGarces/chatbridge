import { Badge, Box, Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconBrandNotion, IconLink, IconLinkOff, IconLoader2 } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { disconnectNotion, getNotionConnectUrl, getNotionStatus } from '@/chatbridge/api-client'

export const Route = createFileRoute('/settings/integrations')({
  component: RouteComponent,
})

type NotionState = {
  loading: boolean
  connected: boolean
  method: 'oauth' | 'api_key' | 'none'
  workspaceName?: string
  connecting: boolean
  error?: string
}

export function RouteComponent() {
  const [notion, setNotion] = useState<NotionState>({
    loading: true,
    connected: false,
    method: 'none',
    connecting: false,
  })

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const status = await getNotionStatus()
      setNotion((prev) => ({
        ...prev,
        loading: false,
        connected: status.connected,
        method: status.method,
        workspaceName: status.workspaceName,
        error: undefined,
      }))
      return status.connected
    } catch {
      setNotion((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to check connection status',
      }))
      return false
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchStatus])

  const handleConnect = useCallback(async () => {
    setNotion((prev) => ({ ...prev, connecting: true, error: undefined }))

    const result = await getNotionConnectUrl()
    if (!result?.authUrl) {
      setNotion((prev) => ({
        ...prev,
        connecting: false,
        error: 'Could not get Notion authorization URL. Check that NOTION_CLIENT_ID is configured on the server.',
      }))
      return
    }

    // Open OAuth popup
    const popup = window.open(result.authUrl, 'notion-oauth', 'width=600,height=700')

    // Poll for connection status
    pollRef.current = setInterval(async () => {
      const connected = await fetchStatus()
      if (connected) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setNotion((prev) => ({ ...prev, connecting: false }))
        try {
          popup?.close()
        } catch {
          /* ignore */
        }
      }
    }, 2000)

    // Stop polling after 2 minutes
    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
        setNotion((prev) => ({ ...prev, connecting: false }))
      }
    }, 120000)
  }, [fetchStatus])

  const handleDisconnect = useCallback(async () => {
    setNotion((prev) => ({ ...prev, loading: true }))
    await disconnectNotion()
    await fetchStatus()
  }, [fetchStatus])

  return (
    <Stack p="md" gap="xl">
      <Title order={5}>Integrations</Title>
      <Text size="sm" c="dimmed">
        Connect third-party services to use them through the chat.
      </Text>

      {/* Notion */}
      <Box
        p="md"
        style={{
          border: '1px solid var(--chatbox-border-primary, #e0e0e0)',
          borderRadius: 8,
        }}
      >
        <Group justify="space-between" align="flex-start">
          <Group gap="sm">
            <IconBrandNotion size={28} />
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={600} size="sm">
                  Notion
                </Text>
                {notion.connected && (
                  <Badge size="xs" color="green" variant="light">
                    {notion.method === 'api_key' ? 'API Key' : 'Connected'}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                Save notes and search your Notion workspace through the chat.
              </Text>
            </Stack>
          </Group>

          {notion.loading ? (
            <IconLoader2
              size={20}
              className="animate-spin"
              style={{ color: 'var(--chatbox-tint-tertiary)' }}
            />
          ) : notion.connected ? (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconLinkOff size={14} />}
              onClick={handleDisconnect}
              disabled={notion.method === 'api_key'}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="xs"
              variant="light"
              leftSection={
                notion.connecting ? (
                  <IconLoader2 size={14} className="animate-spin" />
                ) : (
                  <IconLink size={14} />
                )
              }
              onClick={handleConnect}
              disabled={notion.connecting}
            >
              {notion.connecting ? 'Waiting...' : 'Connect'}
            </Button>
          )}
        </Group>

        {notion.connected && notion.workspaceName && (
          <Text size="xs" c="dimmed" mt="xs">
            Workspace: {notion.workspaceName}
          </Text>
        )}

        {notion.connected && notion.method === 'api_key' && (
          <Text size="xs" c="dimmed" mt="xs">
            Using server API key. To use per-user OAuth, configure NOTION_CLIENT_ID and NOTION_CLIENT_SECRET on the
            server.
          </Text>
        )}

        {notion.error && (
          <Text size="xs" c="red" mt="xs">
            {notion.error}
          </Text>
        )}
      </Box>
    </Stack>
  )
}
