"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
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
    createDynamoDBTables() {
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
    createCognitoUserPool() {
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
    createAppSyncAPI() {
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
                // CRITICAL: Allow Lambda services to use IAM credentials for AppSync calls
                additionalAuthorizationModes: [{
                        authorizationType: appsync.AuthorizationType.IAM,
                    }],
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
            xrayEnabled: true,
        });
    }
    createLambdaFunctions() {
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
            }
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
        // Grant AppSync invoke permissions to Vote Lambda for publishing room matches
        this.voteLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['appsync:GraphQL'],
            resources: [this.api.arn + '/*'],
        }));
        // CRITICAL: Grant AppSync invoke permissions to Match Lambda for executing GraphQL mutations
        this.matchLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['appsync:GraphQL'],
            resources: [this.api.arn + '/*'],
        }));
        // Add GraphQL endpoint to Match Lambda for direct AppSync calls
        this.matchLambda.addEnvironment('GRAPHQL_ENDPOINT', this.api.graphqlUrl);
        // Grant DynamoDB permissions
        this.grantDynamoDBPermissions();
        // Grant Lambda invoke permissions
        this.grantLambdaPermissions();
    }
    grantDynamoDBPermissions() {
        // Grant read/write permissions to all tables for all lambdas
        const lambdas = [this.tmdbLambda, this.roomLambda, this.voteLambda, this.matchLambda];
        const tables = [this.roomsTable, this.votesTable, this.matchesTable, this.usersTable];
        lambdas.forEach(lambdaFn => {
            tables.forEach(table => {
                table.grantReadWriteData(lambdaFn);
            });
        });
    }
    grantLambdaPermissions() {
        // Allow Room Lambda to invoke TMDB Lambda
        this.tmdbLambda.grantInvoke(this.roomLambda);
        // Allow Vote Lambda to invoke Match Lambda
        this.matchLambda.grantInvoke(this.voteLambda);
    }
    createResolvers() {
        // Create Lambda data sources
        const roomDataSource = this.api.addLambdaDataSource('RoomDataSource', this.roomLambda);
        const voteDataSource = this.api.addLambdaDataSource('VoteDataSource', this.voteLambda);
        const matchDataSource = this.api.addLambdaDataSource('MatchDataSource', this.matchLambda);
        // Create NONE data source for publishRoomMatch (subscription trigger)
        const noneDataSource = this.api.addNoneDataSource('NoneDataSource');
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
        // publishRoomMatch mutation - triggers room-based subscription
        // CRITICAL: This resolver must accept IAM authorization for Lambda calls
        const publishRoomMatchResolver = noneDataSource.createResolver('PublishRoomMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishRoomMatch',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": {
            "roomId": "$context.arguments.roomId",
            "matchData": $util.toJson($context.arguments.matchData)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        ## For NONE data source, simply return the input data to trigger subscription
        {
          "roomId": "$context.arguments.roomId",
          "matchId": "$context.arguments.matchData.matchId",
          "movieId": "$context.arguments.matchData.movieId",
          "movieTitle": "$context.arguments.matchData.movieTitle",
          "posterPath": $util.toJson($context.arguments.matchData.posterPath),
          "matchedUsers": $util.toJson($context.arguments.matchData.matchedUsers),
          "timestamp": "$util.time.nowISO8601()",
          "matchDetails": $util.toJson($context.arguments.matchData.matchDetails)
        }
      `),
        });
        // Room membership mutations
        roomDataSource.createResolver('AddRoomMemberResolver', {
            typeName: 'Mutation',
            fieldName: 'addRoomMember',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "addRoomMember",
            "roomId": "$context.arguments.roomId",
            "userId": "$context.arguments.userId",
            "requesterId": "$context.identity.sub"
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
        roomDataSource.createResolver('RemoveRoomMemberResolver', {
            typeName: 'Mutation',
            fieldName: 'removeRoomMember',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "removeRoomMember",
            "roomId": "$context.arguments.roomId",
            "userId": "$context.arguments.userId",
            "requesterId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.success)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        roomDataSource.createResolver('LeaveRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'leaveRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "leaveRoom",
            "roomId": "$context.arguments.roomId",
            "userId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.success)
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
        // Room membership queries
        roomDataSource.createResolver('GetRoomMembersResolver', {
            typeName: 'Query',
            fieldName: 'getRoomMembers',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getRoomMembers",
            "roomId": "$context.arguments.roomId",
            "requesterId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.members)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        roomDataSource.createResolver('GetUserRoomsResolver', {
            typeName: 'Query',
            fieldName: 'getUserRooms',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getUserRooms",
            "userId": "$context.arguments.userId",
            "requesterId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.rooms)
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
    createOutputs() {
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
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCxpRUFBbUQ7QUFDbkQsaUVBQW1EO0FBQ25ELCtEQUFpRDtBQUVqRCx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRTdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBZXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIseUJBQXlCO1FBQ3pCLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBRTVCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUU3Qiw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFFeEIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFFdkIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDO0lBRU8sb0JBQW9CO1FBQzFCLHFCQUFxQjtRQUNyQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3pELFNBQVMsRUFBRSxjQUFjO1lBQ3pCLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsSUFBSTtnQkFDVixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsa0JBQWtCO1lBQzVELG1CQUFtQixFQUFFLElBQUk7WUFDekIsbUJBQW1CLEVBQUUsS0FBSztTQUMzQixDQUFDLENBQUM7UUFFSCw4Q0FBOEM7UUFDOUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQztZQUN0QyxTQUFTLEVBQUUsWUFBWTtZQUN2QixZQUFZLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLE1BQU07Z0JBQ1osSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztTQUNGLENBQUMsQ0FBQztRQUVILHFEQUFxRDtRQUNyRCxJQUFJLENBQUMsVUFBVSxDQUFDLHVCQUF1QixDQUFDO1lBQ3RDLFNBQVMsRUFBRSx3QkFBd0I7WUFDbkMsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLFdBQVc7Z0JBQ2pCLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7U0FDRixDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN6RCxTQUFTLEVBQUUsY0FBYztZQUN6QixZQUFZLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELE9BQU8sRUFBRTtnQkFDUCxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILHFEQUFxRDtRQUNyRCxJQUFJLENBQUMsVUFBVSxDQUFDLHVCQUF1QixDQUFDO1lBQ3RDLFNBQVMsRUFBRSx3QkFBd0I7WUFDbkMsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLFdBQVc7Z0JBQ2pCLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7U0FDRixDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzdELFNBQVMsRUFBRSxnQkFBZ0I7WUFDM0IsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILG9EQUFvRDtRQUNwRCxJQUFJLENBQUMsWUFBWSxDQUFDLHNCQUFzQixDQUFDO1lBQ3ZDLFNBQVMsRUFBRSxpQkFBaUI7WUFDNUIsT0FBTyxFQUFFO2dCQUNQLElBQUksRUFBRSxXQUFXO2dCQUNqQixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsb0VBQW9FO1FBQ3BFLHVEQUF1RDtRQUN2RCxJQUFJLENBQUMsWUFBWSxDQUFDLHVCQUF1QixDQUFDO1lBQ3hDLFNBQVMsRUFBRSx3QkFBd0I7WUFDbkMsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLFdBQVc7Z0JBQ2pCLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7U0FDRixDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN6RCxTQUFTLEVBQUUsY0FBYztZQUN6QixZQUFZLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUk7Z0JBQ1YsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxxQkFBcUI7UUFDM0IsbUJBQW1CO1FBQ25CLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUM1RCxZQUFZLEVBQUUsbUJBQW1CO1lBQ2pDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFO2dCQUNiLEtBQUssRUFBRSxJQUFJO2FBQ1o7WUFDRCx3Q0FBd0M7WUFDeEMsVUFBVSxFQUFFO1lBQ1YsOERBQThEO2FBQy9EO1lBQ0Qsa0JBQWtCLEVBQUU7Z0JBQ2xCLEtBQUssRUFBRTtvQkFDTCxRQUFRLEVBQUUsSUFBSTtvQkFDZCxPQUFPLEVBQUUsSUFBSTtpQkFDZDthQUNGO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGdCQUFnQixFQUFFLEtBQUs7Z0JBQ3ZCLGdCQUFnQixFQUFFLEtBQUs7Z0JBQ3ZCLGFBQWEsRUFBRSxLQUFLO2dCQUNwQixjQUFjLEVBQUUsS0FBSzthQUN0QjtZQUNELGVBQWUsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVU7WUFDbkQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QywyQ0FBMkM7WUFDM0MsY0FBYyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO29CQUN2RCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO29CQUNuQyxPQUFPLEVBQUUsZUFBZTtvQkFDeEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7OztXQVc1QixDQUFDO29CQUNGLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7aUJBQ2xDLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDOUUsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLGtCQUFrQixFQUFFLHVCQUF1QjtZQUMzQyxjQUFjLEVBQUUsS0FBSyxFQUFFLDJCQUEyQjtZQUNsRCxTQUFTLEVBQUU7Z0JBQ1QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsWUFBWSxFQUFFLElBQUk7Z0JBQ2xCLGlCQUFpQixFQUFFLElBQUksRUFBRSxnQ0FBZ0M7Z0JBQ3pELE1BQU0sRUFBRSxLQUFLO2FBQ2Q7WUFDRCwwQkFBMEIsRUFBRSxJQUFJO1lBQ2hDLDhCQUE4QjtZQUM5QixtQkFBbUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDMUMsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUN0QyxvQkFBb0IsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7U0FDNUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLGdCQUFnQjtRQUN0Qiw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwRCxJQUFJLEVBQUUsYUFBYTtZQUNuQixVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztZQUNsRixtQkFBbUIsRUFBRTtnQkFDbkIsb0JBQW9CLEVBQUU7b0JBQ3BCLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO29CQUN0RCxjQUFjLEVBQUU7d0JBQ2QsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO3FCQUN4QjtpQkFDRjtnQkFDRCwyRUFBMkU7Z0JBQzNFLDRCQUE0QixFQUFFLENBQUM7d0JBQzdCLGlCQUFpQixFQUFFLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHO3FCQUNqRCxDQUFDO2FBQ0g7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBRzthQUN6QztZQUNELFdBQVcsRUFBRSxJQUFJO1NBQ2xCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxxQkFBcUI7UUFDM0IsOEJBQThCO1FBQzlCLE1BQU0saUJBQWlCLEdBQUc7WUFDeEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksSUFBSSxFQUFFO2dCQUM1QyxlQUFlLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksRUFBRTtnQkFDbEQsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLDhCQUE4QjtnQkFDMUUsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUztnQkFDdEMsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUztnQkFDdEMsYUFBYSxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUztnQkFDMUMsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUztnQkFDdEMsZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLGlDQUFpQzthQUN4RDtTQUNGLENBQUM7UUFFRiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN4RCxHQUFHLGlCQUFpQjtZQUNwQixZQUFZLEVBQUUsc0JBQXNCO1lBQ3BDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxzQkFBc0IsQ0FBQyxDQUFDO1lBQ3pFLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLFdBQVcsRUFBRSxrREFBa0Q7U0FDaEUsQ0FBQyxDQUFDO1FBRUgsc0JBQXNCO1FBQ3RCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsR0FBRyxpQkFBaUI7WUFDcEIsWUFBWSxFQUFFLHNCQUFzQjtZQUNwQyxJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsc0JBQXNCLENBQUMsQ0FBQztZQUN6RSxPQUFPLEVBQUUsZUFBZTtZQUN4QixXQUFXLEVBQUUsaUNBQWlDO1NBQy9DLENBQUMsQ0FBQztRQUVILHNCQUFzQjtRQUN0QixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3hELEdBQUcsaUJBQWlCO1lBQ3BCLFlBQVksRUFBRSxzQkFBc0I7WUFDcEMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLHNCQUFzQixDQUFDLENBQUM7WUFDekUsT0FBTyxFQUFFLGVBQWU7WUFDeEIsV0FBVyxFQUFFLHFDQUFxQztTQUNuRCxDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUMxRCxHQUFHLGlCQUFpQjtZQUNwQixZQUFZLEVBQUUsdUJBQXVCO1lBQ3JDLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO1lBQzFFLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLFdBQVcsRUFBRSx1Q0FBdUM7U0FDckQsQ0FBQyxDQUFDO1FBRUgsNERBQTREO1FBQzVELElBQUksQ0FBQyxVQUFVLENBQUMsY0FBYyxDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDL0UsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUVqRixxRUFBcUU7UUFDckUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUV4RSw4RUFBOEU7UUFDOUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3RELE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDNUIsU0FBUyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDO1NBQ2pDLENBQUMsQ0FBQyxDQUFDO1FBRUosNkZBQTZGO1FBQzdGLElBQUksQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN2RCxNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLGlCQUFpQixDQUFDO1lBQzVCLFNBQVMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLElBQUksQ0FBQztTQUNqQyxDQUFDLENBQUMsQ0FBQztRQUVKLGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRXpFLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztRQUVoQyxrQ0FBa0M7UUFDbEMsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVPLHdCQUF3QjtRQUM5Qiw2REFBNkQ7UUFDN0QsTUFBTSxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDdEYsTUFBTSxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFdEYsT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUN6QixNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFO2dCQUNyQixLQUFLLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDckMsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxzQkFBc0I7UUFDNUIsMENBQTBDO1FBQzFDLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUU3QywyQ0FBMkM7UUFDM0MsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFTyxlQUFlO1FBQ3JCLDZCQUE2QjtRQUM3QixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN2RixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN2RixNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUUxRixzRUFBc0U7UUFDdEUsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRXBFLHFCQUFxQjtRQUVyQixzQkFBc0I7UUFDdEIsY0FBYyxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsRUFBRTtZQUNsRCxRQUFRLEVBQUUsVUFBVTtZQUNwQixTQUFTLEVBQUUsWUFBWTtZQUN2QixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7OztPQVUxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsb0JBQW9CO1FBQ3BCLGNBQWMsQ0FBQyxjQUFjLENBQUMsa0JBQWtCLEVBQUU7WUFDaEQsUUFBUSxFQUFFLFVBQVU7WUFDcEIsU0FBUyxFQUFFLFVBQVU7WUFDckIsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7Ozs7T0FVMUQsQ0FBQztZQUNGLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7T0FTM0QsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILGdCQUFnQjtRQUNoQixjQUFjLENBQUMsY0FBYyxDQUFDLGNBQWMsRUFBRTtZQUM1QyxRQUFRLEVBQUUsVUFBVTtZQUNwQixTQUFTLEVBQUUsTUFBTTtZQUNqQixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7OztPQVUxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsK0RBQStEO1FBQy9ELHlFQUF5RTtRQUN6RSxNQUFNLHdCQUF3QixHQUFHLGNBQWMsQ0FBQyxjQUFjLENBQUMsMEJBQTBCLEVBQUU7WUFDekYsUUFBUSxFQUFFLFVBQVU7WUFDcEIsU0FBUyxFQUFFLGtCQUFrQjtZQUM3QixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7T0FRMUQsQ0FBQztZQUNGLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7Ozs7T0FZM0QsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILDRCQUE0QjtRQUM1QixjQUFjLENBQUMsY0FBYyxDQUFDLHVCQUF1QixFQUFFO1lBQ3JELFFBQVEsRUFBRSxVQUFVO1lBQ3BCLFNBQVMsRUFBRSxlQUFlO1lBQzFCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7OztPQVcxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsY0FBYyxDQUFDLGNBQWMsQ0FBQywwQkFBMEIsRUFBRTtZQUN4RCxRQUFRLEVBQUUsVUFBVTtZQUNwQixTQUFTLEVBQUUsa0JBQWtCO1lBQzdCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7OztPQVcxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsY0FBYyxDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsRUFBRTtZQUNqRCxRQUFRLEVBQUUsVUFBVTtZQUNwQixTQUFTLEVBQUUsV0FBVztZQUN0QixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7OztPQVUxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBRWxCLHlDQUF5QztRQUN6QyxjQUFjLENBQUMsY0FBYyxDQUFDLGlCQUFpQixFQUFFO1lBQy9DLFFBQVEsRUFBRSxPQUFPO1lBQ2pCLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7O09BVTFELENBQUM7WUFDRix1QkFBdUIsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzNELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxtQkFBbUI7UUFDbkIsY0FBYyxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsRUFBRTtZQUNsRCxRQUFRLEVBQUUsT0FBTztZQUNqQixTQUFTLEVBQUUsWUFBWTtZQUN2QixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzFELENBQUM7WUFDRix1QkFBdUIsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzNELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsY0FBYyxDQUFDLGNBQWMsQ0FBQyx3QkFBd0IsRUFBRTtZQUN0RCxRQUFRLEVBQUUsT0FBTztZQUNqQixTQUFTLEVBQUUsZ0JBQWdCO1lBQzNCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7O09BVTFELENBQUM7WUFDRix1QkFBdUIsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzNELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxjQUFjLENBQUMsY0FBYyxDQUFDLHNCQUFzQixFQUFFO1lBQ3BELFFBQVEsRUFBRSxPQUFPO1lBQ2pCLFNBQVMsRUFBRSxjQUFjO1lBQ3pCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7O09BVTFELENBQUM7WUFDRix1QkFBdUIsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzNELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsZUFBZSxDQUFDLGNBQWMsQ0FBQyxzQkFBc0IsRUFBRTtZQUNyRCxRQUFRLEVBQUUsT0FBTztZQUNqQixTQUFTLEVBQUUsY0FBYztZQUN6QixzQkFBc0IsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzFELENBQUM7WUFDRix1QkFBdUIsRUFBRSxPQUFPLENBQUMsZUFBZSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7O09BUzNELENBQUM7U0FDSCxDQUFDLENBQUM7UUFFSCx5QkFBeUI7UUFDekIsZUFBZSxDQUFDLGNBQWMsQ0FBQywwQkFBMEIsRUFBRTtZQUN6RCxRQUFRLEVBQUUsT0FBTztZQUNqQixTQUFTLEVBQUUsa0JBQWtCO1lBQzdCLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7T0FTMUQsQ0FBQztZQUNGLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7T0FTM0QsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILHVCQUF1QjtRQUN2QixlQUFlLENBQUMsY0FBYyxDQUFDLHdCQUF3QixFQUFFO1lBQ3ZELFFBQVEsRUFBRSxPQUFPO1lBQ2pCLFNBQVMsRUFBRSxnQkFBZ0I7WUFDM0Isc0JBQXNCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLGVBQWUsQ0FBQyxjQUFjLENBQUMscUJBQXFCLEVBQUU7WUFDcEQsUUFBUSxFQUFFLFVBQVU7WUFDcEIsU0FBUyxFQUFFLGFBQWE7WUFDeEIsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMxRCxDQUFDO1lBQ0YsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLGVBQWUsQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7OztPQVMzRCxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0lBQ3hELENBQUM7SUFFTyxhQUFhO1FBQ25CLG9EQUFvRDtRQUNwRCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVO1lBQy9CLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLG1CQUFtQjtTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLGdCQUFnQjtZQUMzQyxXQUFXLEVBQUUsNkJBQTZCO1lBQzFDLFVBQVUsRUFBRSx5QkFBeUI7U0FDdEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVO1lBQzFCLFdBQVcsRUFBRSw4QkFBOEI7WUFDM0MsVUFBVSxFQUFFLHdCQUF3QjtTQUNyQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbEIsV0FBVyxFQUFFLFlBQVk7WUFDekIsVUFBVSxFQUFFLGtCQUFrQjtTQUMvQixDQUFDLENBQUM7UUFFSCxtQ0FBbUM7UUFDbkMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTO1lBQ2xDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBL3lCRCxvQ0EreUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIGFwcHN5bmMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcHN5bmMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XHJcbiAgcHVibGljIHVzZXJQb29sQ2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50O1xyXG4gIHB1YmxpYyBhcGk6IGFwcHN5bmMuR3JhcGhxbEFwaTtcclxuICBwdWJsaWMgcm9vbXNUYWJsZTogZHluYW1vZGIuVGFibGU7XHJcbiAgcHVibGljIHZvdGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyBtYXRjaGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyB1c2Vyc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBcclxuICAvLyBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgcHVibGljIHRtZGJMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcclxuICBwdWJsaWMgcm9vbUxhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyB2b3RlTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIG1hdGNoTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBEeW5hbW9EQiBUYWJsZXNcclxuICAgIHRoaXMuY3JlYXRlRHluYW1vREJUYWJsZXMoKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gVXNlciBQb29sXHJcbiAgICB0aGlzLmNyZWF0ZUNvZ25pdG9Vc2VyUG9vbCgpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBHcmFwaFFMIEFQSVxyXG4gICAgdGhpcy5jcmVhdGVBcHBTeW5jQVBJKCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgICB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9ucygpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBSZXNvbHZlcnNcclxuICAgIHRoaXMuY3JlYXRlUmVzb2x2ZXJzKCk7XHJcblxyXG4gICAgLy8gT3V0cHV0IGltcG9ydGFudCB2YWx1ZXNcclxuICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW9EQlRhYmxlcygpIHtcclxuICAgIC8vIFRyaW5pdHlSb29tcyBUYWJsZVxyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5Um9vbXMnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ1RyaW5pdHlSb29tcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdpZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdsb2JhbCBTZWNvbmRhcnkgSW5kZXggZm9yIHJvb20gY29kZSBsb29rdXBcclxuICAgIHRoaXMucm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnY29kZScsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciBob3N0LWJhc2VkIHJvb20gcXVlcmllc1xyXG4gICAgdGhpcy5yb29tc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnaG9zdElkLWNyZWF0ZWRBdC1pbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdob3N0SWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2NyZWF0ZWRBdCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5Vm90ZXMgVGFibGVcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVZvdGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5Vm90ZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAncm9vbUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd1c2VyTW92aWVJZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciB1c2VyLWJhc2VkIHZvdGUgcXVlcmllc1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAndXNlcklkLXRpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICd1c2VySWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5TWF0Y2hlcyBUYWJsZVxyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlNYXRjaGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5TWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdyb29tSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ21vdmllSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9jYWwgU2Vjb25kYXJ5IEluZGV4IGZvciB0aW1lc3RhbXAtYmFzZWQgcXVlcmllc1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUuYWRkTG9jYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3RpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBBZGQgR2xvYmFsIFNlY29uZGFyeSBJbmRleCBmb3IgdXNlci1iYXNlZCBtYXRjaCBxdWVyaWVzXHJcbiAgICAvLyBUaGlzIGFsbG93cyBlZmZpY2llbnQgcXVlcnlpbmcgb2YgbWF0Y2hlcyBieSB1c2VyIElEXHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3VzZXJJZC10aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAndXNlcklkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eVVzZXJzIFRhYmxlXHJcbiAgICB0aGlzLnVzZXJzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlVc2VycycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eVVzZXJzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2lkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVDb2duaXRvVXNlclBvb2woKSB7XHJcbiAgICAvLyBDcmVhdGUgVXNlciBQb29sXHJcbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1RyaW5pdHlVc2VyUG9vbCcsIHtcclxuICAgICAgdXNlclBvb2xOYW1lOiAndHJpbml0eS11c2VyLXBvb2wnLFxyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczoge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICAvLyBSZW1vdmUgZW1haWwgdmVyaWZpY2F0aW9uIHJlcXVpcmVtZW50XHJcbiAgICAgIGF1dG9WZXJpZnk6IHtcclxuICAgICAgICAvLyBlbWFpbDogdHJ1ZSwgLy8gQ29tbWVudGVkIG91dCB0byBkaXNhYmxlIGVtYWlsIHZlcmlmaWNhdGlvblxyXG4gICAgICB9LFxyXG4gICAgICBzdGFuZGFyZEF0dHJpYnV0ZXM6IHtcclxuICAgICAgICBlbWFpbDoge1xyXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XHJcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxyXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiBmYWxzZSxcclxuICAgICAgfSxcclxuICAgICAgYWNjb3VudFJlY292ZXJ5OiBjb2duaXRvLkFjY291bnRSZWNvdmVyeS5FTUFJTF9PTkxZLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICAvLyBBZGQgTGFtYmRhIHRyaWdnZXIgdG8gYXV0by1jb25maXJtIHVzZXJzXHJcbiAgICAgIGxhbWJkYVRyaWdnZXJzOiB7XHJcbiAgICAgICAgcHJlU2lnblVwOiBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdQcmVTaWduVXBUcmlnZ2VyJywge1xyXG4gICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcclxuICAgICAgICAgICAgZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1ByZVNpZ25VcCB0cmlnZ2VyIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgLy8gQXV0by1jb25maXJtIGFsbCB1c2VycyBhbmQgc2tpcCBlbWFpbCB2ZXJpZmljYXRpb25cclxuICAgICAgICAgICAgICBldmVudC5yZXNwb25zZS5hdXRvQ29uZmlybVVzZXIgPSB0cnVlO1xyXG4gICAgICAgICAgICAgIGV2ZW50LnJlc3BvbnNlLmF1dG9WZXJpZnlFbWFpbCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1ByZVNpZ25VcCByZXNwb25zZTonLCBKU09OLnN0cmluZ2lmeShldmVudC5yZXNwb25zZSwgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICAgIHJldHVybiBldmVudDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIGApLFxyXG4gICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFVzZXIgUG9vbCBDbGllbnRcclxuICAgIHRoaXMudXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVHJpbml0eVVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAndHJpbml0eS1tb2JpbGUtY2xpZW50JyxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLCAvLyBSZXF1aXJlZCBmb3IgbW9iaWxlIGFwcHNcclxuICAgICAgYXV0aEZsb3dzOiB7XHJcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcclxuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXHJcbiAgICAgICAgYWRtaW5Vc2VyUGFzc3dvcmQ6IHRydWUsIC8vIEFkZCB0aGlzIGZvciBhZG1pbiBvcGVyYXRpb25zXHJcbiAgICAgICAgY3VzdG9tOiBmYWxzZSxcclxuICAgICAgfSxcclxuICAgICAgcHJldmVudFVzZXJFeGlzdGVuY2VFcnJvcnM6IHRydWUsXHJcbiAgICAgIC8vIEFkZCBleHBsaWNpdCB0b2tlbiB2YWxpZGl0eVxyXG4gICAgICBhY2Nlc3NUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uaG91cnMoMSksXHJcbiAgICAgIGlkVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxyXG4gICAgICByZWZyZXNoVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUFwcFN5bmNBUEkoKSB7XHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBHcmFwaFFMIEFQSVxyXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBwc3luYy5HcmFwaHFsQXBpKHRoaXMsICdUcmluaXR5QVBJJywge1xyXG4gICAgICBuYW1lOiAndHJpbml0eS1hcGknLFxyXG4gICAgICBkZWZpbml0aW9uOiBhcHBzeW5jLkRlZmluaXRpb24uZnJvbUZpbGUocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NjaGVtYS5ncmFwaHFsJykpLFxyXG4gICAgICBhdXRob3JpemF0aW9uQ29uZmlnOiB7XHJcbiAgICAgICAgZGVmYXVsdEF1dGhvcml6YXRpb246IHtcclxuICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcHBzeW5jLkF1dGhvcml6YXRpb25UeXBlLlVTRVJfUE9PTCxcclxuICAgICAgICAgIHVzZXJQb29sQ29uZmlnOiB7XHJcbiAgICAgICAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIENSSVRJQ0FMOiBBbGxvdyBMYW1iZGEgc2VydmljZXMgdG8gdXNlIElBTSBjcmVkZW50aWFscyBmb3IgQXBwU3luYyBjYWxsc1xyXG4gICAgICAgIGFkZGl0aW9uYWxBdXRob3JpemF0aW9uTW9kZXM6IFt7XHJcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5JQU0sXHJcbiAgICAgICAgfV0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGxvZ0NvbmZpZzoge1xyXG4gICAgICAgIGZpZWxkTG9nTGV2ZWw6IGFwcHN5bmMuRmllbGRMb2dMZXZlbC5BTEwsXHJcbiAgICAgIH0sXHJcbiAgICAgIHhyYXlFbmFibGVkOiB0cnVlLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUxhbWJkYUZ1bmN0aW9ucygpIHtcclxuICAgIC8vIENvbW1vbiBMYW1iZGEgY29uZmlndXJhdGlvblxyXG4gICAgY29uc3QgY29tbW9uTGFtYmRhUHJvcHMgPSB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJyxcclxuICAgICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiB8fCAnJyxcclxuICAgICAgICBUTURCX0JBU0VfVVJMOiBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdodHRwczovL2FwaS50aGVtb3ZpZWRiLm9yZy8zJyxcclxuICAgICAgICBST09NU19UQUJMRTogdGhpcy5yb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdGhpcy52b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiB0aGlzLm1hdGNoZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgVVNFUlNfVEFCTEU6IHRoaXMudXNlcnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgR1JBUEhRTF9FTkRQT0lOVDogJycsIC8vIFdpbGwgYmUgc2V0IGFmdGVyIEFQSSBjcmVhdGlvblxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFRNREIgSW50ZWdyYXRpb24gTGFtYmRhXHJcbiAgICB0aGlzLnRtZGJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdUTURCTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS10bWRiLWhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy90bWRiJykpLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVE1EQiBBUEkgaW50ZWdyYXRpb24gd2l0aCBMYXRpbiBzY3JpcHQgZmlsdGVyaW5nJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb20gSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMucm9vbUxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21MYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXJvb20taGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3Jvb20nKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdSb29tIGNyZWF0aW9uIGFuZCBqb2luaW5nIGxvZ2ljJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFZvdGUgSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMudm90ZUxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvdGVMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXZvdGUtaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3ZvdGUnKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdWb3RlIHByb2Nlc3NpbmcgYW5kIG1hdGNoIGRldGVjdGlvbicsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBNYXRjaCBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy5tYXRjaExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ01hdGNoTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS1tYXRjaC1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvbWF0Y2gnKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdNYXRjaCBjcmVhdGlvbiBhbmQgaGlzdG9yeSBtYW5hZ2VtZW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzIHdpdGggY3Jvc3MtcmVmZXJlbmNlc1xyXG4gICAgdGhpcy5yb29tTGFtYmRhLmFkZEVudmlyb25tZW50KCdUTURCX0xBTUJEQV9BUk4nLCB0aGlzLnRtZGJMYW1iZGEuZnVuY3Rpb25Bcm4pO1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZEVudmlyb25tZW50KCdNQVRDSF9MQU1CREFfQVJOJywgdGhpcy5tYXRjaExhbWJkYS5mdW5jdGlvbkFybik7XHJcbiAgICBcclxuICAgIC8vIEFkZCBHcmFwaFFMIGVuZHBvaW50IHRvIFZvdGUgTGFtYmRhIGZvciBzdWJzY3JpcHRpb24gbm90aWZpY2F0aW9uc1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZEVudmlyb25tZW50KCdHUkFQSFFMX0VORFBPSU5UJywgdGhpcy5hcGkuZ3JhcGhxbFVybCk7XHJcbiAgICBcclxuICAgIC8vIEdyYW50IEFwcFN5bmMgaW52b2tlIHBlcm1pc3Npb25zIHRvIFZvdGUgTGFtYmRhIGZvciBwdWJsaXNoaW5nIHJvb20gbWF0Y2hlc1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcclxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5hcGkuYXJuICsgJy8qJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IEdyYW50IEFwcFN5bmMgaW52b2tlIHBlcm1pc3Npb25zIHRvIE1hdGNoIExhbWJkYSBmb3IgZXhlY3V0aW5nIEdyYXBoUUwgbXV0YXRpb25zXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcclxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5hcGkuYXJuICsgJy8qJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQWRkIEdyYXBoUUwgZW5kcG9pbnQgdG8gTWF0Y2ggTGFtYmRhIGZvciBkaXJlY3QgQXBwU3luYyBjYWxsc1xyXG4gICAgdGhpcy5tYXRjaExhbWJkYS5hZGRFbnZpcm9ubWVudCgnR1JBUEhRTF9FTkRQT0lOVCcsIHRoaXMuYXBpLmdyYXBocWxVcmwpO1xyXG5cclxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXHJcbiAgICB0aGlzLmdyYW50RHluYW1vREJQZXJtaXNzaW9ucygpO1xyXG5cclxuICAgIC8vIEdyYW50IExhbWJkYSBpbnZva2UgcGVybWlzc2lvbnNcclxuICAgIHRoaXMuZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBncmFudER5bmFtb0RCUGVybWlzc2lvbnMoKSB7XHJcbiAgICAvLyBHcmFudCByZWFkL3dyaXRlIHBlcm1pc3Npb25zIHRvIGFsbCB0YWJsZXMgZm9yIGFsbCBsYW1iZGFzXHJcbiAgICBjb25zdCBsYW1iZGFzID0gW3RoaXMudG1kYkxhbWJkYSwgdGhpcy5yb29tTGFtYmRhLCB0aGlzLnZvdGVMYW1iZGEsIHRoaXMubWF0Y2hMYW1iZGFdO1xyXG4gICAgY29uc3QgdGFibGVzID0gW3RoaXMucm9vbXNUYWJsZSwgdGhpcy52b3Rlc1RhYmxlLCB0aGlzLm1hdGNoZXNUYWJsZSwgdGhpcy51c2Vyc1RhYmxlXTtcclxuXHJcbiAgICBsYW1iZGFzLmZvckVhY2gobGFtYmRhRm4gPT4ge1xyXG4gICAgICB0YWJsZXMuZm9yRWFjaCh0YWJsZSA9PiB7XHJcbiAgICAgICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZuKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpIHtcclxuICAgIC8vIEFsbG93IFJvb20gTGFtYmRhIHRvIGludm9rZSBUTURCIExhbWJkYVxyXG4gICAgdGhpcy50bWRiTGFtYmRhLmdyYW50SW52b2tlKHRoaXMucm9vbUxhbWJkYSk7XHJcbiAgICBcclxuICAgIC8vIEFsbG93IFZvdGUgTGFtYmRhIHRvIGludm9rZSBNYXRjaCBMYW1iZGFcclxuICAgIHRoaXMubWF0Y2hMYW1iZGEuZ3JhbnRJbnZva2UodGhpcy52b3RlTGFtYmRhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlUmVzb2x2ZXJzKCkge1xyXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBkYXRhIHNvdXJjZXNcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnUm9vbURhdGFTb3VyY2UnLCB0aGlzLnJvb21MYW1iZGEpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdWb3RlRGF0YVNvdXJjZScsIHRoaXMudm90ZUxhbWJkYSk7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdNYXRjaERhdGFTb3VyY2UnLCB0aGlzLm1hdGNoTGFtYmRhKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgTk9ORSBkYXRhIHNvdXJjZSBmb3IgcHVibGlzaFJvb21NYXRjaCAoc3Vic2NyaXB0aW9uIHRyaWdnZXIpXHJcbiAgICBjb25zdCBub25lRGF0YVNvdXJjZSA9IHRoaXMuYXBpLmFkZE5vbmVEYXRhU291cmNlKCdOb25lRGF0YVNvdXJjZScpO1xyXG5cclxuICAgIC8vIE11dGF0aW9uIFJlc29sdmVyc1xyXG4gICAgXHJcbiAgICAvLyBjcmVhdGVSb29tIG11dGF0aW9uXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnY3JlYXRlUm9vbScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImNyZWF0ZVJvb21cIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJpbnB1dFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLmlucHV0KVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGpvaW5Sb29tIG11dGF0aW9uXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignSm9pblJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2pvaW5Sb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiam9pblJvb21cIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJjb2RlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLmNvZGVcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIHZvdGUgbXV0YXRpb25cclxuICAgIHZvdGVEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdWb3RlUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICd2b3RlJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwidm90ZVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImlucHV0XCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMuaW5wdXQpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gcHVibGlzaFJvb21NYXRjaCBtdXRhdGlvbiAtIHRyaWdnZXJzIHJvb20tYmFzZWQgc3Vic2NyaXB0aW9uXHJcbiAgICAvLyBDUklUSUNBTDogVGhpcyByZXNvbHZlciBtdXN0IGFjY2VwdCBJQU0gYXV0aG9yaXphdGlvbiBmb3IgTGFtYmRhIGNhbGxzXHJcbiAgICBjb25zdCBwdWJsaXNoUm9vbU1hdGNoUmVzb2x2ZXIgPSBub25lRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignUHVibGlzaFJvb21NYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncHVibGlzaFJvb21NYXRjaCcsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoRGF0YVwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YSlcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgIyMgRm9yIE5PTkUgZGF0YSBzb3VyY2UsIHNpbXBseSByZXR1cm4gdGhlIGlucHV0IGRhdGEgdG8gdHJpZ2dlciBzdWJzY3JpcHRpb25cclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgXCJtb3ZpZUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZUlkXCIsXHJcbiAgICAgICAgICBcIm1vdmllVGl0bGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllVGl0bGVcIixcclxuICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoKSxcclxuICAgICAgICAgIFwibWF0Y2hlZFVzZXJzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoZWRVc2VycyksXHJcbiAgICAgICAgICBcInRpbWVzdGFtcFwiOiBcIiR1dGlsLnRpbWUubm93SVNPODYwMSgpXCIsXHJcbiAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb20gbWVtYmVyc2hpcCBtdXRhdGlvbnNcclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdBZGRSb29tTWVtYmVyUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdhZGRSb29tTWVtYmVyJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiYWRkUm9vbU1lbWJlclwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMudXNlcklkXCIsXHJcbiAgICAgICAgICAgIFwicmVxdWVzdGVySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdSZW1vdmVSb29tTWVtYmVyUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdyZW1vdmVSb29tTWVtYmVyJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwicmVtb3ZlUm9vbU1lbWJlclwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMudXNlcklkXCIsXHJcbiAgICAgICAgICAgIFwicmVxdWVzdGVySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5LnN1Y2Nlc3MpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0xlYXZlUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnbGVhdmVSb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwibGVhdmVSb29tXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkuc3VjY2VzcylcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBRdWVyeSBSZXNvbHZlcnNcclxuXHJcbiAgICAvLyBnZXRSb29tIHF1ZXJ5IC0gcmV1c2Ugcm9vbSBkYXRhIHNvdXJjZVxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRSb29tXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLmlkXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBnZXRNeVJvb21zIHF1ZXJ5XHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlSb29tc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlSb29tcycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldE15Um9vbXNcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb20gbWVtYmVyc2hpcCBxdWVyaWVzXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0Um9vbU1lbWJlcnNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJvb21NZW1iZXJzJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiZ2V0Um9vbU1lbWJlcnNcIixcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMucm9vbUlkXCIsXHJcbiAgICAgICAgICAgIFwicmVxdWVzdGVySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1lbWJlcnMpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFVzZXJSb29tc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0VXNlclJvb21zJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiZ2V0VXNlclJvb21zXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnVzZXJJZFwiLFxyXG4gICAgICAgICAgICBcInJlcXVlc3RlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5yb29tcylcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBnZXRNeU1hdGNoZXMgcXVlcnlcclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlNYXRjaGVzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRNeU1hdGNoZXMnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRVc2VyTWF0Y2hlc1wiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkubWF0Y2hlcylcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBjaGVja1VzZXJNYXRjaGVzIHF1ZXJ5XHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NoZWNrVXNlck1hdGNoZXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NoZWNrVXNlck1hdGNoZXMnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJjaGVja1VzZXJNYXRjaGVzXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5tYXRjaGVzKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGNoZWNrUm9vbU1hdGNoIHF1ZXJ5XHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NoZWNrUm9vbU1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjaGVja1Jvb21NYXRjaCcsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImNoZWNrUm9vbU1hdGNoXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkubWF0Y2gpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gY3JlYXRlTWF0Y2ggbXV0YXRpb25cclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiY3JlYXRlTWF0Y2hcIixcclxuICAgICAgICAgICAgXCJpbnB1dFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLmlucHV0KVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1hdGNoKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCdBcHBTeW5jIHJlc29sdmVycyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVPdXRwdXRzKCkge1xyXG4gICAgLy8gT3V0cHV0IHZhbHVlcyBuZWVkZWQgZm9yIG1vYmlsZSBhcHAgY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eVVzZXJQb29sSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlVc2VyUG9vbENsaWVudElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcFN5bmMgR3JhcGhRTCBBUEkgRW5kcG9pbnQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eUdyYXBoUUxFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVdTUmVnaW9uJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIFJlZ2lvbicsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUcmluaXR5QVdTUmVnaW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhYmxlIG5hbWVzIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUm9vbXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFJvb21zIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvdGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy52b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBWb3RlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYXRjaGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5tYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIE1hdGNoZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlcnNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXJzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19