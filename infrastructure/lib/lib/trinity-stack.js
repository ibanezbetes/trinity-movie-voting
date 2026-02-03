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
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
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
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxtRUFBcUQ7QUFDckQsaUVBQW1EO0FBQ25ELGlFQUFtRDtBQUduRCwyQ0FBNkI7QUFHN0IsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixrQkFBa0I7UUFDbEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxFQUFFLGVBQWU7WUFDMUIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxtQkFBbUIsRUFBRSxLQUFLO1lBQzFCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsa0RBQWtEO1FBQ2xELFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQztZQUNqQyxTQUFTLEVBQUUsWUFBWTtZQUN2QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtTQUNwRSxDQUFDLENBQUM7UUFFSCxNQUFNLFVBQVUsR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN4RCxTQUFTLEVBQUUsZUFBZTtZQUMx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QUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsUUFBUSxDQUFDLFVBQVU7WUFDMUIsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxjQUFjLENBQUMsZ0JBQWdCO1lBQ3RDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDaEMsS0FBSyxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ2xCLFdBQVcsRUFBRSxZQUFZO1NBQzFCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9PRCxvQ0ErT0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIGFwcHN5bmMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcHN5bmMnO1xyXG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFRyaW5pdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gRHluYW1vREIgVGFibGVzXHJcbiAgICBjb25zdCByb29tc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdSb29tc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICd0cmluaXR5LXJvb21zJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIEdTSSBmb3Igcm9vbSBjb2RlIGxvb2t1cCAoZmlyc3QgZGVwbG95bWVudClcclxuICAgIHJvb21zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjb2RlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHZvdGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1ZvdGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktdm90ZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3Jvb21JZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3VzZXJNb3ZpZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG1hdGNoZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnTWF0Y2hlc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICd0cmluaXR5LW1hdGNoZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3Jvb21JZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ21vdmllSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUiB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ29nbml0byBVc2VyIFBvb2xcclxuICAgIGNvbnN0IHVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1RyaW5pdHlVc2VyUG9vbCcsIHtcclxuICAgICAgdXNlclBvb2xOYW1lOiAndHJpbml0eS11c2VycycsXHJcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxyXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XHJcbiAgICAgICAgZW1haWw6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIGF1dG9WZXJpZnk6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcclxuICAgICAgICBtaW5MZW5ndGg6IDgsXHJcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IGZhbHNlLFxyXG4gICAgICB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVHJpbml0eVVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAndHJpbml0eS1jbGllbnQnLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcclxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhcGhRTCBBUElcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcHBzeW5jLkdyYXBocWxBcGkodGhpcywgJ1RyaW5pdHlBcGknLCB7XHJcbiAgICAgIG5hbWU6ICd0cmluaXR5LWFwaScsXHJcbiAgICAgIGRlZmluaXRpb246IGFwcHN5bmMuRGVmaW5pdGlvbi5mcm9tRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc2NoZW1hLmdyYXBocWwnKSksXHJcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHtcclxuICAgICAgICBkZWZhdWx0QXV0aG9yaXphdGlvbjoge1xyXG4gICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuVVNFUl9QT09MLFxyXG4gICAgICAgICAgdXNlclBvb2xDb25maWc6IHtcclxuICAgICAgICAgICAgdXNlclBvb2wsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYWRkaXRpb25hbEF1dGhvcml6YXRpb25Nb2RlczogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5JQU0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGxvZ0NvbmZpZzoge1xyXG4gICAgICAgIGZpZWxkTG9nTGV2ZWw6IGFwcHN5bmMuRmllbGRMb2dMZXZlbC5BTEwsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgICBjb25zdCB0bWRiSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1RtZGJIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy90bWRiJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFRNREJfQVBJX0tFWTogcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByb29tSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21IYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9yb29tJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgVE1EQl9MQU1CREFfQVJOOiB0bWRiSGFuZGxlci5mdW5jdGlvbkFybixcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgdm90ZUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdWb3RlSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvdm90ZScpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBST09NU19UQUJMRTogcm9vbXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgR1JBUEhRTF9FTkRQT0lOVDogYXBpLmdyYXBocWxVcmwsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG1hdGNoSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ01hdGNoSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvbWF0Y2gnKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBHUkFQSFFMX0VORFBPSU5UOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJvb21IYW5kbGVyKTtcclxuICAgIHZvdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJvb21IYW5kbGVyKTtcclxuICAgIHZvdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHZvdGVIYW5kbGVyKTtcclxuICAgIG1hdGNoZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodm90ZUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtYXRjaEhhbmRsZXIpO1xyXG4gICAgcm9vbXNUYWJsZS5ncmFudFJlYWREYXRhKHZvdGVIYW5kbGVyKTtcclxuXHJcbiAgICB0bWRiSGFuZGxlci5ncmFudEludm9rZShyb29tSGFuZGxlcik7XHJcblxyXG4gICAgLy8gR3JhbnQgQXBwU3luYyBwZXJtaXNzaW9ucyB0byBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbih2b3RlSGFuZGxlciwgJ3B1Ymxpc2hSb29tTWF0Y2gnKTtcclxuICAgIGFwaS5ncmFudE11dGF0aW9uKHZvdGVIYW5kbGVyLCAncHVibGlzaFVzZXJNYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24obWF0Y2hIYW5kbGVyLCAncHVibGlzaFJvb21NYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24obWF0Y2hIYW5kbGVyLCAncHVibGlzaFVzZXJNYXRjaCcpO1xyXG5cclxuICAgIC8vIERhdGEgU291cmNlc1xyXG4gICAgY29uc3QgdG1kYkRhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVG1kYkRhdGFTb3VyY2UnLCB0bWRiSGFuZGxlcik7XHJcbiAgICBjb25zdCByb29tRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdSb29tRGF0YVNvdXJjZScsIHJvb21IYW5kbGVyKTtcclxuICAgIGNvbnN0IHZvdGVEYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1ZvdGVEYXRhU291cmNlJywgdm90ZUhhbmRsZXIpO1xyXG4gICAgY29uc3QgbWF0Y2hEYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ01hdGNoRGF0YVNvdXJjZScsIG1hdGNoSGFuZGxlcik7XHJcblxyXG4gICAgLy8gUmVzb2x2ZXJzXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnY3JlYXRlUm9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignSm9pblJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2pvaW5Sb29tJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRSb29tJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHZvdGVEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdWb3RlUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICd2b3RlJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlNYXRjaGVzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRNeU1hdGNoZXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3Vic2NyaXB0aW9uIHJlc29sdmVycyAobm8tb3AgcmVzb2x2ZXJzIGZvciB0cmlnZ2VyaW5nIHN1YnNjcmlwdGlvbnMpXHJcbiAgICBhcGkuY3JlYXRlUmVzb2x2ZXIoJ1B1Ymxpc2hSb29tTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3B1Ymxpc2hSb29tTWF0Y2gnLFxyXG4gICAgICBkYXRhU291cmNlOiBhcGkuYWRkTm9uZURhdGFTb3VyY2UoJ05vbmVEYXRhU291cmNlJyksXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzKVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0KVxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGFwaS5jcmVhdGVSZXNvbHZlcignUHVibGlzaFVzZXJNYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncHVibGlzaFVzZXJNYXRjaCcsXHJcbiAgICAgIGRhdGFTb3VyY2U6IGFwaS5hZGROb25lRGF0YVNvdXJjZSgnTm9uZURhdGFTb3VyY2UyJyksXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzKVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0KVxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dHNcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcmFwaFFMIEFQSSBFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR3JhcGhRTEFwaUtleScsIHtcclxuICAgICAgdmFsdWU6IGFwaS5hcGlLZXkgfHwgJ04vQScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3JhcGhRTCBBUEkgS2V5JyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xyXG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcclxuICAgICAgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpb24nLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJlZ2lvbixcclxuICAgICAgZGVzY3JpcHRpb246ICdBV1MgUmVnaW9uJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==