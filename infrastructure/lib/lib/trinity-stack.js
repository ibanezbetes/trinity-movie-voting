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
        matchDataSource.createResolver('PublishRoomMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishRoomMatch',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "publishRoomMatch",
            "roomId": "$context.arguments.roomId",
            "matchData": $util.toJson($context.arguments.matchData)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          ## Return the room match event from the Lambda response
          #if($context.result.body.roomMatchEvent)
            $util.toJson($context.result.body.roomMatchEvent)
          #else
            ## Fallback: construct the event from input arguments
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
          #end
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCxpRUFBbUQ7QUFDbkQsaUVBQW1EO0FBQ25ELCtEQUFpRDtBQUVqRCx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRTdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBZXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIseUJBQXlCO1FBQ3pCLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBRTVCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUU3Qiw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFFeEIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLDJCQUEyQjtRQUMzQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFFdkIsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN2QixDQUFDO0lBRU8sb0JBQW9CO1FBQzFCLHFCQUFxQjtRQUNyQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3pELFNBQVMsRUFBRSxjQUFjO1lBQ3pCLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsSUFBSTtnQkFDVixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxhQUFhLEVB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RjtBQXh6QkQsb0NBd3pCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBhcHBzeW5jIGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcHBzeW5jJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGFOb2RlanMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFRyaW5pdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgcHVibGljIHVzZXJQb29sOiBjb2duaXRvLlVzZXJQb29sO1xyXG4gIHB1YmxpYyB1c2VyUG9vbENsaWVudDogY29nbml0by5Vc2VyUG9vbENsaWVudDtcclxuICBwdWJsaWMgYXBpOiBhcHBzeW5jLkdyYXBocWxBcGk7XHJcbiAgcHVibGljIHJvb21zVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyB2b3Rlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgbWF0Y2hlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBwdWJsaWMgdXNlcnNUYWJsZTogZHluYW1vZGIuVGFibGU7XHJcbiAgXHJcbiAgLy8gTGFtYmRhIEZ1bmN0aW9uc1xyXG4gIHB1YmxpYyB0bWRiTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIHJvb21MYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcclxuICBwdWJsaWMgdm90ZUxhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyBtYXRjaExhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgRHluYW1vREIgVGFibGVzXHJcbiAgICB0aGlzLmNyZWF0ZUR5bmFtb0RCVGFibGVzKCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBDb2duaXRvIFVzZXIgUG9vbFxyXG4gICAgdGhpcy5jcmVhdGVDb2duaXRvVXNlclBvb2woKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgR3JhcGhRTCBBUElcclxuICAgIHRoaXMuY3JlYXRlQXBwU3luY0FQSSgpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgTGFtYmRhIEZ1bmN0aW9uc1xyXG4gICAgdGhpcy5jcmVhdGVMYW1iZGFGdW5jdGlvbnMoKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgUmVzb2x2ZXJzXHJcbiAgICB0aGlzLmNyZWF0ZVJlc29sdmVycygpO1xyXG5cclxuICAgIC8vIE91dHB1dCBpbXBvcnRhbnQgdmFsdWVzXHJcbiAgICB0aGlzLmNyZWF0ZU91dHB1dHMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlRHluYW1vREJUYWJsZXMoKSB7XHJcbiAgICAvLyBUcmluaXR5Um9vbXMgVGFibGVcclxuICAgIHRoaXMucm9vbXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVJvb21zJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5Um9vbXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnaWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBGb3IgZGV2ZWxvcG1lbnRcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciByb29tIGNvZGUgbG9va3VwXHJcbiAgICB0aGlzLnJvb21zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2NvZGUnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR2xvYmFsIFNlY29uZGFyeSBJbmRleCBmb3IgaG9zdC1iYXNlZCByb29tIHF1ZXJpZXNcclxuICAgIHRoaXMucm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2hvc3RJZC1jcmVhdGVkQXQtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnaG9zdElkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICdjcmVhdGVkQXQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eVZvdGVzIFRhYmxlXHJcbiAgICB0aGlzLnZvdGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlWb3RlcycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eVZvdGVzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3Jvb21JZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndXNlck1vdmllSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR2xvYmFsIFNlY29uZGFyeSBJbmRleCBmb3IgdXNlci1iYXNlZCB2b3RlIHF1ZXJpZXNcclxuICAgIHRoaXMudm90ZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3VzZXJJZC10aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAndXNlcklkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eU1hdGNoZXMgVGFibGVcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5TWF0Y2hlcycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eU1hdGNoZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAncm9vbUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICdtb3ZpZUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcclxuICAgICAgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExvY2FsIFNlY29uZGFyeSBJbmRleCBmb3IgdGltZXN0YW1wLWJhc2VkIHF1ZXJpZXNcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlLmFkZExvY2FsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICd0aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDUklUSUNBTDogQWRkIEdsb2JhbCBTZWNvbmRhcnkgSW5kZXggZm9yIHVzZXItYmFzZWQgbWF0Y2ggcXVlcmllc1xyXG4gICAgLy8gVGhpcyBhbGxvd3MgZWZmaWNpZW50IHF1ZXJ5aW5nIG9mIG1hdGNoZXMgYnkgdXNlciBJRFxyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICd1c2VySWQtdGltZXN0YW1wLWluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3VzZXJJZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRyaW5pdHlVc2VycyBUYWJsZVxyXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5VXNlcnMnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ1RyaW5pdHlVc2VycycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdpZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlQ29nbml0b1VzZXJQb29sKCkge1xyXG4gICAgLy8gQ3JlYXRlIFVzZXIgUG9vbFxyXG4gICAgdGhpcy51c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdUcmluaXR5VXNlclBvb2wnLCB7XHJcbiAgICAgIHVzZXJQb29sTmFtZTogJ3RyaW5pdHktdXNlci1wb29sJyxcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgLy8gUmVtb3ZlIGVtYWlsIHZlcmlmaWNhdGlvbiByZXF1aXJlbWVudFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7XHJcbiAgICAgICAgLy8gZW1haWw6IHRydWUsIC8vIENvbW1lbnRlZCBvdXQgdG8gZGlzYWJsZSBlbWFpbCB2ZXJpZmljYXRpb25cclxuICAgICAgfSxcclxuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgZW1haWw6IHtcclxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxyXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlRGlnaXRzOiBmYWxzZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgLy8gQWRkIExhbWJkYSB0cmlnZ2VyIHRvIGF1dG8tY29uZmlybSB1c2Vyc1xyXG4gICAgICBsYW1iZGFUcmlnZ2Vyczoge1xyXG4gICAgICAgIHByZVNpZ25VcDogbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUHJlU2lnblVwVHJpZ2dlcicsIHtcclxuICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXHJcbiAgICAgICAgICAgIGV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdQcmVTaWduVXAgdHJpZ2dlciBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIC8vIEF1dG8tY29uZmlybSBhbGwgdXNlcnMgYW5kIHNraXAgZW1haWwgdmVyaWZpY2F0aW9uXHJcbiAgICAgICAgICAgICAgZXZlbnQucmVzcG9uc2UuYXV0b0NvbmZpcm1Vc2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgICBldmVudC5yZXNwb25zZS5hdXRvVmVyaWZ5RW1haWwgPSB0cnVlO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdQcmVTaWduVXAgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQucmVzcG9uc2UsIG51bGwsIDIpKTtcclxuICAgICAgICAgICAgICByZXR1cm4gZXZlbnQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICBgKSxcclxuICAgICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcclxuICAgICAgICB9KSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBVc2VyIFBvb2wgQ2xpZW50XHJcbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ1RyaW5pdHlVc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXHJcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ3RyaW5pdHktbW9iaWxlLWNsaWVudCcsXHJcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSwgLy8gUmVxdWlyZWQgZm9yIG1vYmlsZSBhcHBzXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJTcnA6IHRydWUsXHJcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxyXG4gICAgICAgIGFkbWluVXNlclBhc3N3b3JkOiB0cnVlLCAvLyBBZGQgdGhpcyBmb3IgYWRtaW4gb3BlcmF0aW9uc1xyXG4gICAgICAgIGN1c3RvbTogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxyXG4gICAgICAvLyBBZGQgZXhwbGljaXQgdG9rZW4gdmFsaWRpdHlcclxuICAgICAgYWNjZXNzVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxyXG4gICAgICBpZFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcclxuICAgICAgcmVmcmVzaFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVBcHBTeW5jQVBJKCkge1xyXG4gICAgLy8gQ3JlYXRlIEFwcFN5bmMgR3JhcGhRTCBBUElcclxuICAgIHRoaXMuYXBpID0gbmV3IGFwcHN5bmMuR3JhcGhxbEFwaSh0aGlzLCAnVHJpbml0eUFQSScsIHtcclxuICAgICAgbmFtZTogJ3RyaW5pdHktYXBpJyxcclxuICAgICAgZGVmaW5pdGlvbjogYXBwc3luYy5EZWZpbml0aW9uLmZyb21GaWxlKHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zY2hlbWEuZ3JhcGhxbCcpKSxcclxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xyXG4gICAgICAgIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XHJcbiAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5VU0VSX1BPT0wsXHJcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xyXG4gICAgICAgICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgICAgeHJheUVuYWJsZWQ6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlTGFtYmRhRnVuY3Rpb25zKCkge1xyXG4gICAgLy8gQ29tbW9uIExhbWJkYSBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBjb21tb25MYW1iZGFQcm9wcyA9IHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFRNREJfQVBJX0tFWTogcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnLFxyXG4gICAgICAgIFRNREJfUkVBRF9UT0tFTjogcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8ICcnLFxyXG4gICAgICAgIFRNREJfQkFTRV9VUkw6IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB0aGlzLnZvdGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIE1BVENIRVNfVEFCTEU6IHRoaXMubWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSU19UQUJMRTogdGhpcy51c2Vyc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBHUkFQSFFMX0VORFBPSU5UOiAnJywgLy8gV2lsbCBiZSBzZXQgYWZ0ZXIgQVBJIGNyZWF0aW9uXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFRNREIgSW50ZWdyYXRpb24gTGFtYmRhXHJcbiAgICB0aGlzLnRtZGJMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdUTURCTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS10bWRiLWhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy90bWRiJykpLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVE1EQiBBUEkgaW50ZWdyYXRpb24gd2l0aCBMYXRpbiBzY3JpcHQgZmlsdGVyaW5nJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb20gSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMucm9vbUxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21MYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXJvb20taGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3Jvb20nKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdSb29tIGNyZWF0aW9uIGFuZCBqb2luaW5nIGxvZ2ljJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFZvdGUgSGFuZGxlciBMYW1iZGFcclxuICAgIHRoaXMudm90ZUxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvdGVMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXZvdGUtaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3ZvdGUnKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdWb3RlIHByb2Nlc3NpbmcgYW5kIG1hdGNoIGRldGVjdGlvbicsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBNYXRjaCBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy5tYXRjaExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ01hdGNoTGFtYmRhJywge1xyXG4gICAgICAuLi5jb21tb25MYW1iZGFQcm9wcyxcclxuICAgICAgZnVuY3Rpb25OYW1lOiAndHJpbml0eS1tYXRjaC1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvbWF0Y2gnKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdNYXRjaCBjcmVhdGlvbiBhbmQgaGlzdG9yeSBtYW5hZ2VtZW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzIHdpdGggY3Jvc3MtcmVmZXJlbmNlc1xyXG4gICAgdGhpcy5yb29tTGFtYmRhLmFkZEVudmlyb25tZW50KCdUTURCX0xBTUJEQV9BUk4nLCB0aGlzLnRtZGJMYW1iZGEuZnVuY3Rpb25Bcm4pO1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZEVudmlyb25tZW50KCdNQVRDSF9MQU1CREFfQVJOJywgdGhpcy5tYXRjaExhbWJkYS5mdW5jdGlvbkFybik7XHJcbiAgICBcclxuICAgIC8vIEFkZCBHcmFwaFFMIGVuZHBvaW50IHRvIFZvdGUgTGFtYmRhIGZvciBzdWJzY3JpcHRpb24gbm90aWZpY2F0aW9uc1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZEVudmlyb25tZW50KCdHUkFQSFFMX0VORFBPSU5UJywgdGhpcy5hcGkuZ3JhcGhxbFVybCk7XHJcbiAgICBcclxuICAgIC8vIEdyYW50IEFwcFN5bmMgaW52b2tlIHBlcm1pc3Npb25zIHRvIFZvdGUgTGFtYmRhIGZvciBwdWJsaXNoaW5nIHJvb20gbWF0Y2hlc1xyXG4gICAgdGhpcy52b3RlTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcclxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5hcGkuYXJuICsgJy8qJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IEdyYW50IEFwcFN5bmMgaW52b2tlIHBlcm1pc3Npb25zIHRvIE1hdGNoIExhbWJkYSBmb3IgZXhlY3V0aW5nIEdyYXBoUUwgbXV0YXRpb25zXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcclxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5hcGkuYXJuICsgJy8qJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQWRkIEdyYXBoUUwgZW5kcG9pbnQgdG8gTWF0Y2ggTGFtYmRhIGZvciBkaXJlY3QgQXBwU3luYyBjYWxsc1xyXG4gICAgdGhpcy5tYXRjaExhbWJkYS5hZGRFbnZpcm9ubWVudCgnR1JBUEhRTF9FTkRQT0lOVCcsIHRoaXMuYXBpLmdyYXBocWxVcmwpO1xyXG5cclxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXHJcbiAgICB0aGlzLmdyYW50RHluYW1vREJQZXJtaXNzaW9ucygpO1xyXG5cclxuICAgIC8vIEdyYW50IExhbWJkYSBpbnZva2UgcGVybWlzc2lvbnNcclxuICAgIHRoaXMuZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBncmFudER5bmFtb0RCUGVybWlzc2lvbnMoKSB7XHJcbiAgICAvLyBHcmFudCByZWFkL3dyaXRlIHBlcm1pc3Npb25zIHRvIGFsbCB0YWJsZXMgZm9yIGFsbCBsYW1iZGFzXHJcbiAgICBjb25zdCBsYW1iZGFzID0gW3RoaXMudG1kYkxhbWJkYSwgdGhpcy5yb29tTGFtYmRhLCB0aGlzLnZvdGVMYW1iZGEsIHRoaXMubWF0Y2hMYW1iZGFdO1xyXG4gICAgY29uc3QgdGFibGVzID0gW3RoaXMucm9vbXNUYWJsZSwgdGhpcy52b3Rlc1RhYmxlLCB0aGlzLm1hdGNoZXNUYWJsZSwgdGhpcy51c2Vyc1RhYmxlXTtcclxuXHJcbiAgICBsYW1iZGFzLmZvckVhY2gobGFtYmRhRm4gPT4ge1xyXG4gICAgICB0YWJsZXMuZm9yRWFjaCh0YWJsZSA9PiB7XHJcbiAgICAgICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZuKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ3JhbnRMYW1iZGFQZXJtaXNzaW9ucygpIHtcclxuICAgIC8vIEFsbG93IFJvb20gTGFtYmRhIHRvIGludm9rZSBUTURCIExhbWJkYVxyXG4gICAgdGhpcy50bWRiTGFtYmRhLmdyYW50SW52b2tlKHRoaXMucm9vbUxhbWJkYSk7XHJcbiAgICBcclxuICAgIC8vIEFsbG93IFZvdGUgTGFtYmRhIHRvIGludm9rZSBNYXRjaCBMYW1iZGFcclxuICAgIHRoaXMubWF0Y2hMYW1iZGEuZ3JhbnRJbnZva2UodGhpcy52b3RlTGFtYmRhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlUmVzb2x2ZXJzKCkge1xyXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBkYXRhIHNvdXJjZXNcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnUm9vbURhdGFTb3VyY2UnLCB0aGlzLnJvb21MYW1iZGEpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdWb3RlRGF0YVNvdXJjZScsIHRoaXMudm90ZUxhbWJkYSk7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSB0aGlzLmFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdNYXRjaERhdGFTb3VyY2UnLCB0aGlzLm1hdGNoTGFtYmRhKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgTk9ORSBkYXRhIHNvdXJjZSBmb3IgcHVibGlzaFJvb21NYXRjaCAoc3Vic2NyaXB0aW9uIHRyaWdnZXIpXHJcbiAgICBjb25zdCBub25lRGF0YVNvdXJjZSA9IHRoaXMuYXBpLmFkZE5vbmVEYXRhU291cmNlKCdOb25lRGF0YVNvdXJjZScpO1xyXG5cclxuICAgIC8vIE11dGF0aW9uIFJlc29sdmVyc1xyXG4gICAgXHJcbiAgICAvLyBjcmVhdGVSb29tIG11dGF0aW9uXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnY3JlYXRlUm9vbScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImNyZWF0ZVJvb21cIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJpbnB1dFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLmlucHV0KVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGpvaW5Sb29tIG11dGF0aW9uXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignSm9pblJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2pvaW5Sb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiam9pblJvb21cIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIixcclxuICAgICAgICAgICAgXCJjb2RlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLmNvZGVcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIHZvdGUgbXV0YXRpb25cclxuICAgIHZvdGVEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdWb3RlUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICd2b3RlJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwidm90ZVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImlucHV0XCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMuaW5wdXQpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gcHVibGlzaFJvb21NYXRjaCBtdXRhdGlvbiAtIHRyaWdnZXJzIHJvb20tYmFzZWQgc3Vic2NyaXB0aW9uXHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ1B1Ymxpc2hSb29tTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3B1Ymxpc2hSb29tTWF0Y2gnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJwdWJsaXNoUm9vbU1hdGNoXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoRGF0YVwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YSlcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICMjIFJldHVybiB0aGUgcm9vbSBtYXRjaCBldmVudCBmcm9tIHRoZSBMYW1iZGEgcmVzcG9uc2VcclxuICAgICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuYm9keS5yb29tTWF0Y2hFdmVudClcclxuICAgICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5LnJvb21NYXRjaEV2ZW50KVxyXG4gICAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICAgIyMgRmFsbGJhY2s6IGNvbnN0cnVjdCB0aGUgZXZlbnQgZnJvbSBpbnB1dCBhcmd1bWVudHNcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgICAgIFwibW92aWVJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVJZFwiLFxyXG4gICAgICAgICAgICAgIFwibW92aWVUaXRsZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVUaXRsZVwiLFxyXG4gICAgICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoKSxcclxuICAgICAgICAgICAgICBcIm1hdGNoZWRVc2Vyc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaGVkVXNlcnMpLFxyXG4gICAgICAgICAgICAgIFwidGltZXN0YW1wXCI6IFwiJHV0aWwudGltZS5ub3dJU084NjAxKClcIixcclxuICAgICAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICNlbmRcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSb29tIG1lbWJlcnNoaXAgbXV0YXRpb25zXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQWRkUm9vbU1lbWJlclJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnYWRkUm9vbU1lbWJlcicsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImFkZFJvb21NZW1iZXJcIixcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMucm9vbUlkXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnVzZXJJZFwiLFxyXG4gICAgICAgICAgICBcInJlcXVlc3RlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignUmVtb3ZlUm9vbU1lbWJlclJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncmVtb3ZlUm9vbU1lbWJlcicsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcInJlbW92ZVJvb21NZW1iZXJcIixcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMucm9vbUlkXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnVzZXJJZFwiLFxyXG4gICAgICAgICAgICBcInJlcXVlc3RlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5zdWNjZXNzKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdMZWF2ZVJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2xlYXZlUm9vbScsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImxlYXZlUm9vbVwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5LnN1Y2Nlc3MpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUXVlcnkgUmVzb2x2ZXJzXHJcblxyXG4gICAgLy8gZ2V0Um9vbSBxdWVyeSAtIHJldXNlIHJvb20gZGF0YSBzb3VyY2VcclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRSb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiZ2V0Um9vbVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5pZFwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gZ2V0TXlSb29tcyBxdWVyeVxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldE15Um9vbXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldE15Um9vbXMnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRNeVJvb21zXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSb29tIG1lbWJlcnNoaXAgcXVlcmllc1xyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJvb21NZW1iZXJzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRSb29tTWVtYmVycycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldFJvb21NZW1iZXJzXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcInJlcXVlc3RlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5tZW1iZXJzKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRVc2VyUm9vbXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFVzZXJSb29tcycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldFVzZXJSb29tc1wiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy51c2VySWRcIixcclxuICAgICAgICAgICAgXCJyZXF1ZXN0ZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkucm9vbXMpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gZ2V0TXlNYXRjaGVzIHF1ZXJ5XHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldE15TWF0Y2hlc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlNYXRjaGVzJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiZ2V0VXNlck1hdGNoZXNcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1hdGNoZXMpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gY2hlY2tVc2VyTWF0Y2hlcyBxdWVyeVxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDaGVja1VzZXJNYXRjaGVzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjaGVja1VzZXJNYXRjaGVzJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiY2hlY2tVc2VyTWF0Y2hlc1wiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkubWF0Y2hlcylcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBjaGVja1Jvb21NYXRjaCBxdWVyeVxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDaGVja1Jvb21NYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnY2hlY2tSb29tTWF0Y2gnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJjaGVja1Jvb21NYXRjaFwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1hdGNoKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGNyZWF0ZU1hdGNoIG11dGF0aW9uXHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NyZWF0ZU1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjcmVhdGVNYXRjaCcsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImNyZWF0ZU1hdGNoXCIsXHJcbiAgICAgICAgICAgIFwiaW5wdXRcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5pbnB1dClcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5tYXRjaClcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZygnQXBwU3luYyByZXNvbHZlcnMgY3JlYXRlZCBzdWNjZXNzZnVsbHknKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlT3V0cHV0cygpIHtcclxuICAgIC8vIE91dHB1dCB2YWx1ZXMgbmVlZGVkIGZvciBtb2JpbGUgYXBwIGNvbmZpZ3VyYXRpb25cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlVc2VyUG9vbElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUcmluaXR5VXNlclBvb2xDbGllbnRJZCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR3JhcGhRTEVuZHBvaW50Jywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5hcGkuZ3JhcGhxbFVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdBcHBTeW5jIEdyYXBoUUwgQVBJIEVuZHBvaW50JyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlHcmFwaFFMRW5kcG9pbnQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FXU1JlZ2lvbicsIHtcclxuICAgICAgdmFsdWU6IHRoaXMucmVnaW9uLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FXUyBSZWdpb24nLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eUFXU1JlZ2lvbicsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUYWJsZSBuYW1lcyBmb3IgTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Jvb21zVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBSb29tcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWb3Rlc1RhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMudm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgVm90ZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWF0Y2hlc1RhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMubWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBNYXRjaGVzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy51c2Vyc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBVc2VycyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==