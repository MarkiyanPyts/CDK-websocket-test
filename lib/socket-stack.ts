import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_iam,
  aws_lambda_event_sources as lambdaEventSources,
} from "aws-cdk-lib";
import * as apigateway from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class RealTimeNotificationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const dynamoTable = new dynamodb.Table(this, 'MyDynamoTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    // Lambda Function
    const writeLambda = new lambda.Function(this, 'MyWriteLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'index.handler',
    });

    const connectFunction = new lambda.Function(this, 'MyConnectFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'index.connect',
    });

    const disconnectFunction = new lambda.Function(this, 'MyDisConnectFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lambda'),
      handler: 'index.disconnect',
    });
    
    // Grant necessary permissions to the Lambda function to access DynamoDB Stream
    dynamoTable.grantStreamRead(writeLambda);
    writeLambda.addEventSource(new lambdaEventSources.DynamoEventSource(dynamoTable, {
      startingPosition: lambda.StartingPosition.LATEST,
    }));


    // WebSocket API
    const webSocketApi = new apigateway.WebSocketApi(this, 'MyWebSocketAPI', {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', connectFunction),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectFunction),
      },
    });
    new apigateway.WebSocketStage(this, 'mystage', {
      webSocketApi,
      stageName: 'dev',
      autoDeploy: true,
    });

    console.log(webSocketApi.apiId)
    const webSocketArn = Stack.of(this).formatArn({
      service: 'execute-api',
      resource: webSocketApi.apiId,
    });
    writeLambda.addToRolePolicy(
      new aws_iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [webSocketArn + '/*'], // Replace with the appropriate resource ARN
      })
    );

    writeLambda.addToRolePolicy(
      new aws_iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`${webSocketArn}/@connections/*`],
      })
    );

    // Lambda integration for WebSocket route

    webSocketApi.addRoute('/', {
      integration: new WebSocketLambdaIntegration('SendMessageIntegration', writeLambda),
    });

    writeLambda.addEnvironment('WEBSOCKET_API_ENDPOINT', webSocketApi.apiEndpoint + '/dev');

    // WebSocket route

    // Output the WebSocket API endpoint
    new CfnOutput(this, 'WebSocketEndpoint', {
      value: webSocketApi.apiEndpoint,
    });
    
  }
}