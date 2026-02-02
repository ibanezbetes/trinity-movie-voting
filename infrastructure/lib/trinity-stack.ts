import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class TrinityStack extends cdk.Stack {
  public userPool: cognito.UserPool;
  public userPoolClient: cognito.UserPoolClient;
  public api: appsync.GraphqlApi;
  public roomsTable: dynamodb.Table;
  public votesTable: dynamodb.Table;
  public matchesTable: dynamodb.Table;
  public usersTable: dynamodb.Table;
  
  // Lambda Functions
  public tmdbLambda: lambda.Function;
  public roomLambda: lambda.Function;
  public voteLambda: lambda.Function;
  public matchLambda: lambda.Function;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create DynamoDB Tables
    this.createDynamoDBTables();
    
    // Create Cognito User Pool
    this.createCognitoUserPool();
    
    // Create AppSync GraphQL API
    this.createAppSyncAPI();
    
    // Create Lambda Functions
    this.createLambdaFunctions();
    
    // Create AppSync Resolvers
    this.createResolvers();

    // Output important values
    this.createOutputs();
  }

  private createDynamoDBTables() {
    // TrinityRooms Table
    this.roomsTable = new dynamodb.Table(this, 'TrinityRooms', {
      tableName: 'TrinityRooms',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Global Secondary Index for room code lookup
    this.roomsTable.addGlobalSecondaryIndex({
      indexName: 'code-index',
      partitionKey: {
        name: 'code',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Global Secondary Index for host-based room queries
    this.roomsTable.addGlobalSecondaryIndex({
      indexName: 'hostId-createdAt-index',
      partitionKey: {
        name: 'hostId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // TrinityVotes Table
    this.votesTable = new dynamodb.Table(this, 'TrinityVotes', {
      tableName: 'TrinityVotes',
      partitionKey: {
        name: 'roomId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userMovieId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // Global Secondary Index for user-based vote queries
    this.votesTable.addGlobalSecondaryIndex({
      indexName: 'userId-timestamp-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // TrinityMatches Table
    this.matchesTable = new dynamodb.Table(this, 'TrinityMatches', {
      tableName: 'TrinityMatches',
      partitionKey: {
        name: 'roomId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'movieId',
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // Local Secondary Index for timestamp-based queries
    this.matchesTable.addLocalSecondaryIndex({
      indexName: 'timestamp-index',
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // CRITICAL: Add Global Secondary Index for user-based match queries
    // This allows efficient querying of matches by user ID
    this.matchesTable.addGlobalSecondaryIndex({
      indexName: 'userId-timestamp-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // TrinityUsers Table
    this.usersTable = new dynamodb.Table(this, 'TrinityUsers', {
      tableName: 'TrinityUsers',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });
  }

  private createCognitoUserPool() {
    // Create User Pool
    this.userPool = new cognito.UserPool(this, 'TrinityUserPool', {
      userPoolName: 'trinity-user-pool',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      // Remove email verification requirement
      autoVerify: {
        // email: true, // Commented out to disable email verification
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Add Lambda trigger to auto-confirm users
      lambdaTriggers: {
        preSignUp: new lambda.Function(this, 'PreSignUpTrigger', {
          runtime: lambda.Runtime.NODEJS_20_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline(`
            exports.handler = async (event) => {
              console.log('PreSignUp trigger event:', JSON.stringify(event, null, 2));
              
              // Auto-confirm all users and skip email verification
              event.response.autoConfirmUser = true;
              event.response.autoVerifyEmail = true;
              
              console.log('PreSignUp response:', JSON.stringify(event.response, null, 2));
              return event;
            };
          `),
          timeout: cdk.Duration.seconds(10),
        }),
      },
    });

    // Create User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'trinity-mobile-client',
      generateSecret: false, // Required for mobile apps
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true, // Add this for admin operations
        custom: false,
      },
      preventUserExistenceErrors: true,
      // Add explicit token validity
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
  }

  private createAppSyncAPI() {
    // Create AppSync GraphQL API
    this.api = new appsync.GraphqlApi(this, 'TrinityAPI', {
      name: 'trinity-api',
      definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: this.userPool,
          },
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
      xrayEnabled: true,
    });
  }

  private createLambdaFunctions() {
    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TMDB_API_KEY: process.env.TMDB_API_KEY || '',
        TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || '',
        TMDB_BASE_URL: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
        ROOMS_TABLE: this.roomsTable.tableName,
        VOTES_TABLE: this.votesTable.tableName,
        MATCHES_TABLE: this.matchesTable.tableName,
        USERS_TABLE: this.usersTable.tableName,
        GRAPHQL_ENDPOINT: '', // Will be set after API creation
      },
    };

    // TMDB Integration Lambda
    this.tmdbLambda = new lambda.Function(this, 'TMDBLambda', {
      ...commonLambdaProps,
      functionName: 'trinity-tmdb-handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
      handler: 'index.handler',
      description: 'TMDB API integration with Latin script filtering',
    });

    // Room Handler Lambda
    this.roomLambda = new lambda.Function(this, 'RoomLambda', {
      ...commonLambdaProps,
      functionName: 'trinity-room-handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
      handler: 'index.handler',
      description: 'Room creation and joining logic',
    });

    // Vote Handler Lambda
    this.voteLambda = new lambda.Function(this, 'VoteLambda', {
      ...commonLambdaProps,
      functionName: 'trinity-vote-handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
      handler: 'index.handler',
      description: 'Vote processing and match detection',
    });

    // Match Handler Lambda
    this.matchLambda = new lambda.Function(this, 'MatchLambda', {
      ...commonLambdaProps,
      functionName: 'trinity-match-handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
      handler: 'index.handler',
      description: 'Match creation and history management',
    });

    // Update Lambda environment variables with cross-references
    this.roomLambda.addEnvironment('TMDB_LAMBDA_ARN', this.tmdbLambda.functionArn);
    this.voteLambda.addEnvironment('MATCH_LAMBDA_ARN', this.matchLambda.functionArn);
    
    // Add GraphQL endpoint to Vote Lambda for subscription notifications
    this.voteLambda.addEnvironment('GRAPHQL_ENDPOINT', this.api.graphqlUrl);

    // Grant DynamoDB permissions
    this.grantDynamoDBPermissions();

    // Grant Lambda invoke permissions
    this.grantLambdaPermissions();
  }

  private grantDynamoDBPermissions() {
    // Grant read/write permissions to all tables for all lambdas
    const lambdas = [this.tmdbLambda, this.roomLambda, this.voteLambda, this.matchLambda];
    const tables = [this.roomsTable, this.votesTable, this.matchesTable, this.usersTable];

    lambdas.forEach(lambdaFn => {
      tables.forEach(table => {
        table.grantReadWriteData(lambdaFn);
      });
    });
  }

  private grantLambdaPermissions() {
    // Allow Room Lambda to invoke TMDB Lambda
    this.tmdbLambda.grantInvoke(this.roomLambda);
    
    // Allow Vote Lambda to invoke Match Lambda
    this.matchLambda.grantInvoke(this.voteLambda);
  }

  private createResolvers() {
    // Create Lambda data sources
    const roomDataSource = this.api.addLambdaDataSource('RoomDataSource', this.roomLambda);
    const voteDataSource = this.api.addLambdaDataSource('VoteDataSource', this.voteLambda);
    const matchDataSource = this.api.addLambdaDataSource('MatchDataSource', this.matchLambda);

    // Mutation Resolvers
    
    // createRoom mutation
    roomDataSource.createResolver('CreateRoomResolver', {
      typeName: 'Mutation',
      fieldName: 'createRoom',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "createRoom",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // joinRoom mutation
    roomDataSource.createResolver('JoinRoomResolver', {
      typeName: 'Mutation',
      fieldName: 'joinRoom',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "joinRoom",
            "userId": "$context.identity.sub",
            "code": "$context.arguments.code"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // vote mutation
    voteDataSource.createResolver('VoteResolver', {
      typeName: 'Mutation',
      fieldName: 'vote',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "vote",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // Query Resolvers

    // getRoom query - reuse room data source
    roomDataSource.createResolver('GetRoomResolver', {
      typeName: 'Query',
      fieldName: 'getRoom',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getRoom",
            "userId": "$context.identity.sub",
            "roomId": "$context.arguments.id"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // getMyRooms query
    roomDataSource.createResolver('GetMyRoomsResolver', {
      typeName: 'Query',
      fieldName: 'getMyRooms',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getMyRooms",
            "userId": "$context.identity.sub"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // getMyMatches query
    matchDataSource.createResolver('GetMyMatchesResolver', {
      typeName: 'Query',
      fieldName: 'getMyMatches',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getUserMatches",
            "userId": "$context.identity.sub"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.matches)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // checkUserMatches query
    matchDataSource.createResolver('CheckUserMatchesResolver', {
      typeName: 'Query',
      fieldName: 'checkUserMatches',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "checkUserMatches",
            "userId": "$context.identity.sub"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.matches)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // checkRoomMatch query
    matchDataSource.createResolver('CheckRoomMatchResolver', {
      typeName: 'Query',
      fieldName: 'checkRoomMatch',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "checkRoomMatch",
            "roomId": "$context.arguments.roomId"
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.match)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    // createMatch mutation
    matchDataSource.createResolver('CreateMatchResolver', {
      typeName: 'Mutation',
      fieldName: 'createMatch',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "createMatch",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.match)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
    });

    console.log('AppSync resolvers created successfully');
  }

  private createOutputs() {
    // Output values needed for mobile app configuration
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'TrinityUserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'TrinityUserPoolClientId',
    });

    new cdk.CfnOutput(this, 'GraphQLEndpoint', {
      value: this.api.graphqlUrl,
      description: 'AppSync GraphQL API Endpoint',
      exportName: 'TrinityGraphQLEndpoint',
    });

    new cdk.CfnOutput(this, 'AWSRegion', {
      value: this.region,
      description: 'AWS Region',
      exportName: 'TrinityAWSRegion',
    });

    // Table names for Lambda functions
    new cdk.CfnOutput(this, 'RoomsTableName', {
      value: this.roomsTable.tableName,
      description: 'DynamoDB Rooms Table Name',
    });

    new cdk.CfnOutput(this, 'VotesTableName', {
      value: this.votesTable.tableName,
      description: 'DynamoDB Votes Table Name',
    });

    new cdk.CfnOutput(this, 'MatchesTableName', {
      value: this.matchesTable.tableName,
      description: 'DynamoDB Matches Table Name',
    });

    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      description: 'DynamoDB Users Table Name',
    });
  }
}