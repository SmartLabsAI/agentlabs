import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AgentChatConversationsService } from 'src/agent-chat/agent-chat-conversations/agent-chat-conversations.service';
import { AgentChatMessagesService } from 'src/agent-chat/agent-chat-messages/agent-chat-messages.service';
import { AgentConnectionManagerService } from 'src/agent-connection-manager/agent-connection-manager.service';
import { FrontendConnectionManagerService } from 'src/frontend-connection-manager/frontend-connection-manager.service';
import { FrontendChatMessageDto } from './dto/frontend-chat-message.dto';

@WebSocketGateway({ namespace: '/frontend' })
export class FrontendConnectionGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(FrontendConnectionGateway.name);

  constructor(
    private readonly frontendConnectionManagerService: FrontendConnectionManagerService,
    private readonly agentConnectionManagerService: AgentConnectionManagerService,
    private readonly conversationsService: AgentChatConversationsService,
    private readonly messagesService: AgentChatMessagesService,
  ) {}

  handleConnection(client: Socket) {
    const projectId = client.handshake.headers['x-agentlabs-project-id'];
    const agentId = client.handshake.headers['x-agentlabs-agent-id'];
    const userId = client.handshake.headers['x-agentlabs-user-id'];

    this.logger.debug(
      `Frontend client connected: project=${projectId} agent=${agentId} user=${userId}`,
    );

    if (typeof userId !== 'string') {
      const message =
        'Failed to identify frontend client: Missing user ID. Expected header: x-agentlabs-user-id';

      this.logger.error(message);
      client.send({
        message,
      });
      client.disconnect(true);

      return;
    }

    if (typeof projectId !== 'string') {
      const message =
        'Failed to identify frontend client: Missing project ID. Expected header: x-agentlabs-project-id';

      this.logger.error(message);
      client.send({
        message,
      });
      client.disconnect(true);

      return;
    }

    if (typeof agentId !== 'string') {
      const message =
        'Failed to identify frontend client: Missing agent ID. Expected header: x-agentlabs-agent-id';

      this.logger.error(message);
      client.send({
        message,
      });
      client.disconnect(true);

      return;
    }

    this.frontendConnectionManagerService.registerConnection({
      socket: client,
      agentId,
      projectId,
      memberId: userId,
    });

    client.send('Connected to server, waiting for messages...');
  }

  handleDisconnect(client: Socket) {
    this.frontendConnectionManagerService.removeConnectionBySid(client.id);
    this.logger.debug(`Frontend client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat-message')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FrontendChatMessageDto,
  ) {
    const frontendConnection =
      this.frontendConnectionManagerService.getConnectionBySid(client.id);

    if (!frontendConnection) {
      return {
        error: 'Failed to send message: Unknown connection',
      };
    }

    let conversationId = payload.conversationId;

    if (!conversationId) {
      const { id } = await this.conversationsService.createConversation({
        agentId: frontendConnection.agentId,
        memberId: frontendConnection.memberId,
      });

      conversationId = id;
    }

    const message = await this.messagesService.createMessage({
      source: 'USER',
      text: payload.text,
      conversationId,
    });

    const agentConnection = this.agentConnectionManagerService.getConnection(
      frontendConnection.projectId,
      frontendConnection.agentId,
    );

    if (!agentConnection) {
      return {
        error: 'Failed to contact agent: not connected.',
      };
    }

    agentConnection.socket.emit('chat-message', {
      data: {
        text: payload.text,
        conversationId,
        messageId: message.id,
      },
    });
  }

  @SubscribeMessage('message')
  handleMessage(client: any, payload: any): string {
    return 'Hello world!';
  }
}
