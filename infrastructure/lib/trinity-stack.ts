import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

export class TrinityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const roomsTable = new dynamodb.Table(this, 'RoomsTable', {
      tableName: 'trinity-rooms',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for room code lookup (first deployment)
    roomsTable.addGlobalSecondaryIndex({
      indexName: 'code-index',
      partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
    });

    const votesTable = new dynamodb.Table(this, 'VotesTable', {
      tableName: 'trinity-votes',
      partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userMovieId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const matchesTable = new dynamodb.Table(this, 'MatchesTable', {
      tableName: 'trinity-matches',
      partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'movieId', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
      userPoolName: 'trinity-users',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
      userPool,
      userPoolClientName: 'trinity-client',
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
    });

    // GraphQL API
    const api = new appsync.GraphqlApi(this, 'TrinityApi', {
      name: 'trinity-api',
      definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.IAM,
          },
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
    });

    // Lambda Functions
    const tmdbHandler = new lambda.Function(this, 'TmdbHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
      environment: {
        TMDB_API_KEY: process.env.TMDB_API_KEY || '',
      },
      timeout: cdk.Duration.seconds(30),
    });

    const roomHandler = new lambda.Function(this, 'RoomHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
      environment: {
        ROOMS_TABLE: roomsTable.tableName,
        VOTES_TABLE: votesTable.tableName,
        TMDB_LAMBDA_ARN: tmdbHandler.functionArn,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const voteHandler = new lambda.Function(this, 'VoteHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
      environment: {
        VOTES_TABLE: votesTable.tableName,
        MATCHES_TABLE: matchesTable.tableName,
        ROOMS_TABLE: roomsTable.tableName,
        GRAPHQL_ENDPOINT: api.graphqlUrl,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const matchHandler = new lambda.Function(this, 'MatchHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
      environment: {
        MATCHES_TABLE: matchesTable.tableName,
        GRAPHQL_ENDPOINT: api.graphqlUrl,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // Grant permissions
    roomsTable.grantReadWriteData(roomHandler);
    votesTable.grantReadWriteData(roomHandler);
    votesTable.grantReadWriteData(voteHandler);
    matchesTable.grantReadWriteData(voteHandler);
    matchesTable.grantReadWriteData(matchHandler);
    roomsTable.grantReadData(voteHandler);

    tmdbHandler.grantInvoke(roomHandler);

    // Grant AppSync permissions to Lambda functions
    api.grantMutation(voteHandler, 'publishRoomMatch');
    api.grantMutation(voteHandler, 'publishUserMatch');
    api.grantMutation(matchHandler, 'publishRoomMatch');
    api.grantMutation(matchHandler, 'publishUserMatch');

    // Data Sources
    const tmdbDataSource = api.addLambdaDataSource('TmdbDataSource', tmdbHandler);
    const roomDataSource = api.addLambdaDataSource('RoomDataSource', roomHandler);
    const voteDataSource = api.addLambdaDataSource('VoteDataSource', voteHandler);
    const matchDataSource = api.addLambdaDataSource('MatchDataSource', matchHandler);

    // Resolvers
    roomDataSource.createResolver('CreateRoomResolver', {
      typeName: 'Mutation',
      fieldName: 'createRoom',
    });

    roomDataSource.createResolver('JoinRoomResolver', {
      typeName: 'Mutation',
      fieldName: 'joinRoom',
    });

    roomDataSource.createResolver('GetRoomResolver', {
      typeName: 'Query',
      fieldName: 'getRoom',
    });

    voteDataSource.createResolver('VoteResolver', {
      typeName: 'Mutation',
      fieldName: 'vote',
    });

    matchDataSource.createResolver('GetMyMatchesResolver', {
      typeName: 'Query',
      fieldName: 'getMyMatches',
    });

    // Subscription resolvers (no-op resolvers for triggering subscriptions)
    api.createResolver('PublishRoomMatchResolver', {
      typeName: 'Mutation',
      fieldName: 'publishRoomMatch',
      dataSource: api.addNoneDataSource('NoneDataSource'),
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": $util.toJson($context.arguments)
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
    });

    api.createResolver('PublishUserMatchResolver', {
      typeName: 'Mutation',
      fieldName: 'publishUserMatch',
      dataSource: api.addNoneDataSource('NoneDataSource2'),
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": $util.toJson($context.arguments)
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        $util.toJson($context.result)
      `),
    });

    // Outputs
    new cdk.CfnOutput(this, 'GraphQLEndpoint', {
      value: api.graphqlUrl,
      description: 'GraphQL API Endpoint',
    });

    new cdk.CfnOutput(this, 'GraphQLApiKey', {
      value: api.apiKey || 'N/A',
      description: 'GraphQL API Key',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
    });
  }
}