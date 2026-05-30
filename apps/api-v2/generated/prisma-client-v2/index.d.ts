
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Mission
 * 
 */
export type Mission = $Result.DefaultSelection<Prisma.$MissionPayload>
/**
 * Model MissionStep
 * 
 */
export type MissionStep = $Result.DefaultSelection<Prisma.$MissionStepPayload>
/**
 * Model MemoryMeta
 * 
 */
export type MemoryMeta = $Result.DefaultSelection<Prisma.$MemoryMetaPayload>
/**
 * Model VaultAccessLog
 * 
 */
export type VaultAccessLog = $Result.DefaultSelection<Prisma.$VaultAccessLogPayload>
/**
 * Model KnowledgeNode
 * 
 */
export type KnowledgeNode = $Result.DefaultSelection<Prisma.$KnowledgeNodePayload>
/**
 * Model KnowledgeEdge
 * 
 */
export type KnowledgeEdge = $Result.DefaultSelection<Prisma.$KnowledgeEdgePayload>

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Missions
 * const missions = await prisma.mission.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Missions
   * const missions = await prisma.mission.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.mission`: Exposes CRUD operations for the **Mission** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Missions
    * const missions = await prisma.mission.findMany()
    * ```
    */
  get mission(): Prisma.MissionDelegate<ExtArgs>;

  /**
   * `prisma.missionStep`: Exposes CRUD operations for the **MissionStep** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more MissionSteps
    * const missionSteps = await prisma.missionStep.findMany()
    * ```
    */
  get missionStep(): Prisma.MissionStepDelegate<ExtArgs>;

  /**
   * `prisma.memoryMeta`: Exposes CRUD operations for the **MemoryMeta** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more MemoryMetas
    * const memoryMetas = await prisma.memoryMeta.findMany()
    * ```
    */
  get memoryMeta(): Prisma.MemoryMetaDelegate<ExtArgs>;

  /**
   * `prisma.vaultAccessLog`: Exposes CRUD operations for the **VaultAccessLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more VaultAccessLogs
    * const vaultAccessLogs = await prisma.vaultAccessLog.findMany()
    * ```
    */
  get vaultAccessLog(): Prisma.VaultAccessLogDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeNode`: Exposes CRUD operations for the **KnowledgeNode** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeNodes
    * const knowledgeNodes = await prisma.knowledgeNode.findMany()
    * ```
    */
  get knowledgeNode(): Prisma.KnowledgeNodeDelegate<ExtArgs>;

  /**
   * `prisma.knowledgeEdge`: Exposes CRUD operations for the **KnowledgeEdge** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more KnowledgeEdges
    * const knowledgeEdges = await prisma.knowledgeEdge.findMany()
    * ```
    */
  get knowledgeEdge(): Prisma.KnowledgeEdgeDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Mission: 'Mission',
    MissionStep: 'MissionStep',
    MemoryMeta: 'MemoryMeta',
    VaultAccessLog: 'VaultAccessLog',
    KnowledgeNode: 'KnowledgeNode',
    KnowledgeEdge: 'KnowledgeEdge'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "mission" | "missionStep" | "memoryMeta" | "vaultAccessLog" | "knowledgeNode" | "knowledgeEdge"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Mission: {
        payload: Prisma.$MissionPayload<ExtArgs>
        fields: Prisma.MissionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MissionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MissionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          findFirst: {
            args: Prisma.MissionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MissionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          findMany: {
            args: Prisma.MissionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>[]
          }
          create: {
            args: Prisma.MissionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          createMany: {
            args: Prisma.MissionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MissionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>[]
          }
          delete: {
            args: Prisma.MissionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          update: {
            args: Prisma.MissionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          deleteMany: {
            args: Prisma.MissionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MissionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.MissionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionPayload>
          }
          aggregate: {
            args: Prisma.MissionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMission>
          }
          groupBy: {
            args: Prisma.MissionGroupByArgs<ExtArgs>
            result: $Utils.Optional<MissionGroupByOutputType>[]
          }
          count: {
            args: Prisma.MissionCountArgs<ExtArgs>
            result: $Utils.Optional<MissionCountAggregateOutputType> | number
          }
        }
      }
      MissionStep: {
        payload: Prisma.$MissionStepPayload<ExtArgs>
        fields: Prisma.MissionStepFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MissionStepFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MissionStepFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          findFirst: {
            args: Prisma.MissionStepFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MissionStepFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          findMany: {
            args: Prisma.MissionStepFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>[]
          }
          create: {
            args: Prisma.MissionStepCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          createMany: {
            args: Prisma.MissionStepCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MissionStepCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>[]
          }
          delete: {
            args: Prisma.MissionStepDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          update: {
            args: Prisma.MissionStepUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          deleteMany: {
            args: Prisma.MissionStepDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MissionStepUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.MissionStepUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MissionStepPayload>
          }
          aggregate: {
            args: Prisma.MissionStepAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMissionStep>
          }
          groupBy: {
            args: Prisma.MissionStepGroupByArgs<ExtArgs>
            result: $Utils.Optional<MissionStepGroupByOutputType>[]
          }
          count: {
            args: Prisma.MissionStepCountArgs<ExtArgs>
            result: $Utils.Optional<MissionStepCountAggregateOutputType> | number
          }
        }
      }
      MemoryMeta: {
        payload: Prisma.$MemoryMetaPayload<ExtArgs>
        fields: Prisma.MemoryMetaFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MemoryMetaFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MemoryMetaFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          findFirst: {
            args: Prisma.MemoryMetaFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MemoryMetaFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          findMany: {
            args: Prisma.MemoryMetaFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>[]
          }
          create: {
            args: Prisma.MemoryMetaCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          createMany: {
            args: Prisma.MemoryMetaCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MemoryMetaCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>[]
          }
          delete: {
            args: Prisma.MemoryMetaDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          update: {
            args: Prisma.MemoryMetaUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          deleteMany: {
            args: Prisma.MemoryMetaDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MemoryMetaUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.MemoryMetaUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MemoryMetaPayload>
          }
          aggregate: {
            args: Prisma.MemoryMetaAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMemoryMeta>
          }
          groupBy: {
            args: Prisma.MemoryMetaGroupByArgs<ExtArgs>
            result: $Utils.Optional<MemoryMetaGroupByOutputType>[]
          }
          count: {
            args: Prisma.MemoryMetaCountArgs<ExtArgs>
            result: $Utils.Optional<MemoryMetaCountAggregateOutputType> | number
          }
        }
      }
      VaultAccessLog: {
        payload: Prisma.$VaultAccessLogPayload<ExtArgs>
        fields: Prisma.VaultAccessLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.VaultAccessLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.VaultAccessLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          findFirst: {
            args: Prisma.VaultAccessLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.VaultAccessLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          findMany: {
            args: Prisma.VaultAccessLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>[]
          }
          create: {
            args: Prisma.VaultAccessLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          createMany: {
            args: Prisma.VaultAccessLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.VaultAccessLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>[]
          }
          delete: {
            args: Prisma.VaultAccessLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          update: {
            args: Prisma.VaultAccessLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          deleteMany: {
            args: Prisma.VaultAccessLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.VaultAccessLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.VaultAccessLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$VaultAccessLogPayload>
          }
          aggregate: {
            args: Prisma.VaultAccessLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateVaultAccessLog>
          }
          groupBy: {
            args: Prisma.VaultAccessLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<VaultAccessLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.VaultAccessLogCountArgs<ExtArgs>
            result: $Utils.Optional<VaultAccessLogCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeNode: {
        payload: Prisma.$KnowledgeNodePayload<ExtArgs>
        fields: Prisma.KnowledgeNodeFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeNodeFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeNodeFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          findFirst: {
            args: Prisma.KnowledgeNodeFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeNodeFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          findMany: {
            args: Prisma.KnowledgeNodeFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>[]
          }
          create: {
            args: Prisma.KnowledgeNodeCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          createMany: {
            args: Prisma.KnowledgeNodeCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeNodeCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>[]
          }
          delete: {
            args: Prisma.KnowledgeNodeDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          update: {
            args: Prisma.KnowledgeNodeUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeNodeDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeNodeUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeNodeUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeNodePayload>
          }
          aggregate: {
            args: Prisma.KnowledgeNodeAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeNode>
          }
          groupBy: {
            args: Prisma.KnowledgeNodeGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeNodeGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeNodeCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeNodeCountAggregateOutputType> | number
          }
        }
      }
      KnowledgeEdge: {
        payload: Prisma.$KnowledgeEdgePayload<ExtArgs>
        fields: Prisma.KnowledgeEdgeFieldRefs
        operations: {
          findUnique: {
            args: Prisma.KnowledgeEdgeFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.KnowledgeEdgeFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          findFirst: {
            args: Prisma.KnowledgeEdgeFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.KnowledgeEdgeFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          findMany: {
            args: Prisma.KnowledgeEdgeFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>[]
          }
          create: {
            args: Prisma.KnowledgeEdgeCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          createMany: {
            args: Prisma.KnowledgeEdgeCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.KnowledgeEdgeCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>[]
          }
          delete: {
            args: Prisma.KnowledgeEdgeDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          update: {
            args: Prisma.KnowledgeEdgeUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          deleteMany: {
            args: Prisma.KnowledgeEdgeDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.KnowledgeEdgeUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.KnowledgeEdgeUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$KnowledgeEdgePayload>
          }
          aggregate: {
            args: Prisma.KnowledgeEdgeAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateKnowledgeEdge>
          }
          groupBy: {
            args: Prisma.KnowledgeEdgeGroupByArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeEdgeGroupByOutputType>[]
          }
          count: {
            args: Prisma.KnowledgeEdgeCountArgs<ExtArgs>
            result: $Utils.Optional<KnowledgeEdgeCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type MissionCountOutputType
   */

  export type MissionCountOutputType = {
    steps: number
  }

  export type MissionCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    steps?: boolean | MissionCountOutputTypeCountStepsArgs
  }

  // Custom InputTypes
  /**
   * MissionCountOutputType without action
   */
  export type MissionCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionCountOutputType
     */
    select?: MissionCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * MissionCountOutputType without action
   */
  export type MissionCountOutputTypeCountStepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MissionStepWhereInput
  }


  /**
   * Count Type KnowledgeNodeCountOutputType
   */

  export type KnowledgeNodeCountOutputType = {
    outEdges: number
    inEdges: number
  }

  export type KnowledgeNodeCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    outEdges?: boolean | KnowledgeNodeCountOutputTypeCountOutEdgesArgs
    inEdges?: boolean | KnowledgeNodeCountOutputTypeCountInEdgesArgs
  }

  // Custom InputTypes
  /**
   * KnowledgeNodeCountOutputType without action
   */
  export type KnowledgeNodeCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNodeCountOutputType
     */
    select?: KnowledgeNodeCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * KnowledgeNodeCountOutputType without action
   */
  export type KnowledgeNodeCountOutputTypeCountOutEdgesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeEdgeWhereInput
  }

  /**
   * KnowledgeNodeCountOutputType without action
   */
  export type KnowledgeNodeCountOutputTypeCountInEdgesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeEdgeWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Mission
   */

  export type AggregateMission = {
    _count: MissionCountAggregateOutputType | null
    _min: MissionMinAggregateOutputType | null
    _max: MissionMaxAggregateOutputType | null
  }

  export type MissionMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    title: string | null
    objective: string | null
    status: string | null
    createdAt: Date | null
    startedAt: Date | null
    completedAt: Date | null
    updatedAt: Date | null
  }

  export type MissionMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    title: string | null
    objective: string | null
    status: string | null
    createdAt: Date | null
    startedAt: Date | null
    completedAt: Date | null
    updatedAt: Date | null
  }

  export type MissionCountAggregateOutputType = {
    id: number
    projectId: number
    title: number
    objective: number
    status: number
    context: number
    createdAt: number
    startedAt: number
    completedAt: number
    updatedAt: number
    _all: number
  }


  export type MissionMinAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    objective?: true
    status?: true
    createdAt?: true
    startedAt?: true
    completedAt?: true
    updatedAt?: true
  }

  export type MissionMaxAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    objective?: true
    status?: true
    createdAt?: true
    startedAt?: true
    completedAt?: true
    updatedAt?: true
  }

  export type MissionCountAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    objective?: true
    status?: true
    context?: true
    createdAt?: true
    startedAt?: true
    completedAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MissionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Mission to aggregate.
     */
    where?: MissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Missions to fetch.
     */
    orderBy?: MissionOrderByWithRelationInput | MissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Missions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Missions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Missions
    **/
    _count?: true | MissionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MissionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MissionMaxAggregateInputType
  }

  export type GetMissionAggregateType<T extends MissionAggregateArgs> = {
        [P in keyof T & keyof AggregateMission]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMission[P]>
      : GetScalarType<T[P], AggregateMission[P]>
  }




  export type MissionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MissionWhereInput
    orderBy?: MissionOrderByWithAggregationInput | MissionOrderByWithAggregationInput[]
    by: MissionScalarFieldEnum[] | MissionScalarFieldEnum
    having?: MissionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MissionCountAggregateInputType | true
    _min?: MissionMinAggregateInputType
    _max?: MissionMaxAggregateInputType
  }

  export type MissionGroupByOutputType = {
    id: string
    projectId: string
    title: string
    objective: string
    status: string
    context: JsonValue
    createdAt: Date
    startedAt: Date | null
    completedAt: Date | null
    updatedAt: Date
    _count: MissionCountAggregateOutputType | null
    _min: MissionMinAggregateOutputType | null
    _max: MissionMaxAggregateOutputType | null
  }

  type GetMissionGroupByPayload<T extends MissionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MissionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MissionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MissionGroupByOutputType[P]>
            : GetScalarType<T[P], MissionGroupByOutputType[P]>
        }
      >
    >


  export type MissionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    title?: boolean
    objective?: boolean
    status?: boolean
    context?: boolean
    createdAt?: boolean
    startedAt?: boolean
    completedAt?: boolean
    updatedAt?: boolean
    steps?: boolean | Mission$stepsArgs<ExtArgs>
    _count?: boolean | MissionCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["mission"]>

  export type MissionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    title?: boolean
    objective?: boolean
    status?: boolean
    context?: boolean
    createdAt?: boolean
    startedAt?: boolean
    completedAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["mission"]>

  export type MissionSelectScalar = {
    id?: boolean
    projectId?: boolean
    title?: boolean
    objective?: boolean
    status?: boolean
    context?: boolean
    createdAt?: boolean
    startedAt?: boolean
    completedAt?: boolean
    updatedAt?: boolean
  }

  export type MissionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    steps?: boolean | Mission$stepsArgs<ExtArgs>
    _count?: boolean | MissionCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type MissionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $MissionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Mission"
    objects: {
      steps: Prisma.$MissionStepPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      title: string
      objective: string
      status: string
      context: Prisma.JsonValue
      createdAt: Date
      startedAt: Date | null
      completedAt: Date | null
      updatedAt: Date
    }, ExtArgs["result"]["mission"]>
    composites: {}
  }

  type MissionGetPayload<S extends boolean | null | undefined | MissionDefaultArgs> = $Result.GetResult<Prisma.$MissionPayload, S>

  type MissionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<MissionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: MissionCountAggregateInputType | true
    }

  export interface MissionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Mission'], meta: { name: 'Mission' } }
    /**
     * Find zero or one Mission that matches the filter.
     * @param {MissionFindUniqueArgs} args - Arguments to find a Mission
     * @example
     * // Get one Mission
     * const mission = await prisma.mission.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MissionFindUniqueArgs>(args: SelectSubset<T, MissionFindUniqueArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Mission that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {MissionFindUniqueOrThrowArgs} args - Arguments to find a Mission
     * @example
     * // Get one Mission
     * const mission = await prisma.mission.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MissionFindUniqueOrThrowArgs>(args: SelectSubset<T, MissionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Mission that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionFindFirstArgs} args - Arguments to find a Mission
     * @example
     * // Get one Mission
     * const mission = await prisma.mission.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MissionFindFirstArgs>(args?: SelectSubset<T, MissionFindFirstArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Mission that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionFindFirstOrThrowArgs} args - Arguments to find a Mission
     * @example
     * // Get one Mission
     * const mission = await prisma.mission.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MissionFindFirstOrThrowArgs>(args?: SelectSubset<T, MissionFindFirstOrThrowArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Missions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Missions
     * const missions = await prisma.mission.findMany()
     * 
     * // Get first 10 Missions
     * const missions = await prisma.mission.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const missionWithIdOnly = await prisma.mission.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MissionFindManyArgs>(args?: SelectSubset<T, MissionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Mission.
     * @param {MissionCreateArgs} args - Arguments to create a Mission.
     * @example
     * // Create one Mission
     * const Mission = await prisma.mission.create({
     *   data: {
     *     // ... data to create a Mission
     *   }
     * })
     * 
     */
    create<T extends MissionCreateArgs>(args: SelectSubset<T, MissionCreateArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Missions.
     * @param {MissionCreateManyArgs} args - Arguments to create many Missions.
     * @example
     * // Create many Missions
     * const mission = await prisma.mission.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MissionCreateManyArgs>(args?: SelectSubset<T, MissionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Missions and returns the data saved in the database.
     * @param {MissionCreateManyAndReturnArgs} args - Arguments to create many Missions.
     * @example
     * // Create many Missions
     * const mission = await prisma.mission.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Missions and only return the `id`
     * const missionWithIdOnly = await prisma.mission.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MissionCreateManyAndReturnArgs>(args?: SelectSubset<T, MissionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Mission.
     * @param {MissionDeleteArgs} args - Arguments to delete one Mission.
     * @example
     * // Delete one Mission
     * const Mission = await prisma.mission.delete({
     *   where: {
     *     // ... filter to delete one Mission
     *   }
     * })
     * 
     */
    delete<T extends MissionDeleteArgs>(args: SelectSubset<T, MissionDeleteArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Mission.
     * @param {MissionUpdateArgs} args - Arguments to update one Mission.
     * @example
     * // Update one Mission
     * const mission = await prisma.mission.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MissionUpdateArgs>(args: SelectSubset<T, MissionUpdateArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Missions.
     * @param {MissionDeleteManyArgs} args - Arguments to filter Missions to delete.
     * @example
     * // Delete a few Missions
     * const { count } = await prisma.mission.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MissionDeleteManyArgs>(args?: SelectSubset<T, MissionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Missions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Missions
     * const mission = await prisma.mission.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MissionUpdateManyArgs>(args: SelectSubset<T, MissionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Mission.
     * @param {MissionUpsertArgs} args - Arguments to update or create a Mission.
     * @example
     * // Update or create a Mission
     * const mission = await prisma.mission.upsert({
     *   create: {
     *     // ... data to create a Mission
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Mission we want to update
     *   }
     * })
     */
    upsert<T extends MissionUpsertArgs>(args: SelectSubset<T, MissionUpsertArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Missions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionCountArgs} args - Arguments to filter Missions to count.
     * @example
     * // Count the number of Missions
     * const count = await prisma.mission.count({
     *   where: {
     *     // ... the filter for the Missions we want to count
     *   }
     * })
    **/
    count<T extends MissionCountArgs>(
      args?: Subset<T, MissionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MissionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Mission.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MissionAggregateArgs>(args: Subset<T, MissionAggregateArgs>): Prisma.PrismaPromise<GetMissionAggregateType<T>>

    /**
     * Group by Mission.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MissionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MissionGroupByArgs['orderBy'] }
        : { orderBy?: MissionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MissionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMissionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Mission model
   */
  readonly fields: MissionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Mission.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MissionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    steps<T extends Mission$stepsArgs<ExtArgs> = {}>(args?: Subset<T, Mission$stepsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Mission model
   */ 
  interface MissionFieldRefs {
    readonly id: FieldRef<"Mission", 'String'>
    readonly projectId: FieldRef<"Mission", 'String'>
    readonly title: FieldRef<"Mission", 'String'>
    readonly objective: FieldRef<"Mission", 'String'>
    readonly status: FieldRef<"Mission", 'String'>
    readonly context: FieldRef<"Mission", 'Json'>
    readonly createdAt: FieldRef<"Mission", 'DateTime'>
    readonly startedAt: FieldRef<"Mission", 'DateTime'>
    readonly completedAt: FieldRef<"Mission", 'DateTime'>
    readonly updatedAt: FieldRef<"Mission", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Mission findUnique
   */
  export type MissionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter, which Mission to fetch.
     */
    where: MissionWhereUniqueInput
  }

  /**
   * Mission findUniqueOrThrow
   */
  export type MissionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter, which Mission to fetch.
     */
    where: MissionWhereUniqueInput
  }

  /**
   * Mission findFirst
   */
  export type MissionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter, which Mission to fetch.
     */
    where?: MissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Missions to fetch.
     */
    orderBy?: MissionOrderByWithRelationInput | MissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Missions.
     */
    cursor?: MissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Missions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Missions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Missions.
     */
    distinct?: MissionScalarFieldEnum | MissionScalarFieldEnum[]
  }

  /**
   * Mission findFirstOrThrow
   */
  export type MissionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter, which Mission to fetch.
     */
    where?: MissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Missions to fetch.
     */
    orderBy?: MissionOrderByWithRelationInput | MissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Missions.
     */
    cursor?: MissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Missions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Missions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Missions.
     */
    distinct?: MissionScalarFieldEnum | MissionScalarFieldEnum[]
  }

  /**
   * Mission findMany
   */
  export type MissionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter, which Missions to fetch.
     */
    where?: MissionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Missions to fetch.
     */
    orderBy?: MissionOrderByWithRelationInput | MissionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Missions.
     */
    cursor?: MissionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Missions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Missions.
     */
    skip?: number
    distinct?: MissionScalarFieldEnum | MissionScalarFieldEnum[]
  }

  /**
   * Mission create
   */
  export type MissionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * The data needed to create a Mission.
     */
    data: XOR<MissionCreateInput, MissionUncheckedCreateInput>
  }

  /**
   * Mission createMany
   */
  export type MissionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Missions.
     */
    data: MissionCreateManyInput | MissionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Mission createManyAndReturn
   */
  export type MissionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Missions.
     */
    data: MissionCreateManyInput | MissionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Mission update
   */
  export type MissionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * The data needed to update a Mission.
     */
    data: XOR<MissionUpdateInput, MissionUncheckedUpdateInput>
    /**
     * Choose, which Mission to update.
     */
    where: MissionWhereUniqueInput
  }

  /**
   * Mission updateMany
   */
  export type MissionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Missions.
     */
    data: XOR<MissionUpdateManyMutationInput, MissionUncheckedUpdateManyInput>
    /**
     * Filter which Missions to update
     */
    where?: MissionWhereInput
  }

  /**
   * Mission upsert
   */
  export type MissionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * The filter to search for the Mission to update in case it exists.
     */
    where: MissionWhereUniqueInput
    /**
     * In case the Mission found by the `where` argument doesn't exist, create a new Mission with this data.
     */
    create: XOR<MissionCreateInput, MissionUncheckedCreateInput>
    /**
     * In case the Mission was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MissionUpdateInput, MissionUncheckedUpdateInput>
  }

  /**
   * Mission delete
   */
  export type MissionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
    /**
     * Filter which Mission to delete.
     */
    where: MissionWhereUniqueInput
  }

  /**
   * Mission deleteMany
   */
  export type MissionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Missions to delete
     */
    where?: MissionWhereInput
  }

  /**
   * Mission.steps
   */
  export type Mission$stepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    where?: MissionStepWhereInput
    orderBy?: MissionStepOrderByWithRelationInput | MissionStepOrderByWithRelationInput[]
    cursor?: MissionStepWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MissionStepScalarFieldEnum | MissionStepScalarFieldEnum[]
  }

  /**
   * Mission without action
   */
  export type MissionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Mission
     */
    select?: MissionSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionInclude<ExtArgs> | null
  }


  /**
   * Model MissionStep
   */

  export type AggregateMissionStep = {
    _count: MissionStepCountAggregateOutputType | null
    _avg: MissionStepAvgAggregateOutputType | null
    _sum: MissionStepSumAggregateOutputType | null
    _min: MissionStepMinAggregateOutputType | null
    _max: MissionStepMaxAggregateOutputType | null
  }

  export type MissionStepAvgAggregateOutputType = {
    retries: number | null
  }

  export type MissionStepSumAggregateOutputType = {
    retries: number | null
  }

  export type MissionStepMinAggregateOutputType = {
    id: string | null
    missionId: string | null
    title: string | null
    status: string | null
    skillId: string | null
    prompt: string | null
    retries: number | null
    executor: string | null
    approvalGateId: string | null
    startedAt: Date | null
    completedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MissionStepMaxAggregateOutputType = {
    id: string | null
    missionId: string | null
    title: string | null
    status: string | null
    skillId: string | null
    prompt: string | null
    retries: number | null
    executor: string | null
    approvalGateId: string | null
    startedAt: Date | null
    completedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MissionStepCountAggregateOutputType = {
    id: number
    missionId: number
    title: number
    status: number
    skillId: number
    prompt: number
    input: number
    output: number
    dependsOn: number
    retries: number
    executor: number
    approvalGateId: number
    startedAt: number
    completedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type MissionStepAvgAggregateInputType = {
    retries?: true
  }

  export type MissionStepSumAggregateInputType = {
    retries?: true
  }

  export type MissionStepMinAggregateInputType = {
    id?: true
    missionId?: true
    title?: true
    status?: true
    skillId?: true
    prompt?: true
    retries?: true
    executor?: true
    approvalGateId?: true
    startedAt?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MissionStepMaxAggregateInputType = {
    id?: true
    missionId?: true
    title?: true
    status?: true
    skillId?: true
    prompt?: true
    retries?: true
    executor?: true
    approvalGateId?: true
    startedAt?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MissionStepCountAggregateInputType = {
    id?: true
    missionId?: true
    title?: true
    status?: true
    skillId?: true
    prompt?: true
    input?: true
    output?: true
    dependsOn?: true
    retries?: true
    executor?: true
    approvalGateId?: true
    startedAt?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MissionStepAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MissionStep to aggregate.
     */
    where?: MissionStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MissionSteps to fetch.
     */
    orderBy?: MissionStepOrderByWithRelationInput | MissionStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MissionStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MissionSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MissionSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned MissionSteps
    **/
    _count?: true | MissionStepCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MissionStepAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MissionStepSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MissionStepMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MissionStepMaxAggregateInputType
  }

  export type GetMissionStepAggregateType<T extends MissionStepAggregateArgs> = {
        [P in keyof T & keyof AggregateMissionStep]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMissionStep[P]>
      : GetScalarType<T[P], AggregateMissionStep[P]>
  }




  export type MissionStepGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MissionStepWhereInput
    orderBy?: MissionStepOrderByWithAggregationInput | MissionStepOrderByWithAggregationInput[]
    by: MissionStepScalarFieldEnum[] | MissionStepScalarFieldEnum
    having?: MissionStepScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MissionStepCountAggregateInputType | true
    _avg?: MissionStepAvgAggregateInputType
    _sum?: MissionStepSumAggregateInputType
    _min?: MissionStepMinAggregateInputType
    _max?: MissionStepMaxAggregateInputType
  }

  export type MissionStepGroupByOutputType = {
    id: string
    missionId: string
    title: string
    status: string
    skillId: string | null
    prompt: string | null
    input: JsonValue
    output: JsonValue | null
    dependsOn: string[]
    retries: number
    executor: string
    approvalGateId: string | null
    startedAt: Date | null
    completedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: MissionStepCountAggregateOutputType | null
    _avg: MissionStepAvgAggregateOutputType | null
    _sum: MissionStepSumAggregateOutputType | null
    _min: MissionStepMinAggregateOutputType | null
    _max: MissionStepMaxAggregateOutputType | null
  }

  type GetMissionStepGroupByPayload<T extends MissionStepGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MissionStepGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MissionStepGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MissionStepGroupByOutputType[P]>
            : GetScalarType<T[P], MissionStepGroupByOutputType[P]>
        }
      >
    >


  export type MissionStepSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    missionId?: boolean
    title?: boolean
    status?: boolean
    skillId?: boolean
    prompt?: boolean
    input?: boolean
    output?: boolean
    dependsOn?: boolean
    retries?: boolean
    executor?: boolean
    approvalGateId?: boolean
    startedAt?: boolean
    completedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    mission?: boolean | MissionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["missionStep"]>

  export type MissionStepSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    missionId?: boolean
    title?: boolean
    status?: boolean
    skillId?: boolean
    prompt?: boolean
    input?: boolean
    output?: boolean
    dependsOn?: boolean
    retries?: boolean
    executor?: boolean
    approvalGateId?: boolean
    startedAt?: boolean
    completedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    mission?: boolean | MissionDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["missionStep"]>

  export type MissionStepSelectScalar = {
    id?: boolean
    missionId?: boolean
    title?: boolean
    status?: boolean
    skillId?: boolean
    prompt?: boolean
    input?: boolean
    output?: boolean
    dependsOn?: boolean
    retries?: boolean
    executor?: boolean
    approvalGateId?: boolean
    startedAt?: boolean
    completedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type MissionStepInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    mission?: boolean | MissionDefaultArgs<ExtArgs>
  }
  export type MissionStepIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    mission?: boolean | MissionDefaultArgs<ExtArgs>
  }

  export type $MissionStepPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "MissionStep"
    objects: {
      mission: Prisma.$MissionPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      missionId: string
      title: string
      status: string
      skillId: string | null
      prompt: string | null
      input: Prisma.JsonValue
      output: Prisma.JsonValue | null
      dependsOn: string[]
      retries: number
      executor: string
      approvalGateId: string | null
      startedAt: Date | null
      completedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["missionStep"]>
    composites: {}
  }

  type MissionStepGetPayload<S extends boolean | null | undefined | MissionStepDefaultArgs> = $Result.GetResult<Prisma.$MissionStepPayload, S>

  type MissionStepCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<MissionStepFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: MissionStepCountAggregateInputType | true
    }

  export interface MissionStepDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['MissionStep'], meta: { name: 'MissionStep' } }
    /**
     * Find zero or one MissionStep that matches the filter.
     * @param {MissionStepFindUniqueArgs} args - Arguments to find a MissionStep
     * @example
     * // Get one MissionStep
     * const missionStep = await prisma.missionStep.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MissionStepFindUniqueArgs>(args: SelectSubset<T, MissionStepFindUniqueArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one MissionStep that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {MissionStepFindUniqueOrThrowArgs} args - Arguments to find a MissionStep
     * @example
     * // Get one MissionStep
     * const missionStep = await prisma.missionStep.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MissionStepFindUniqueOrThrowArgs>(args: SelectSubset<T, MissionStepFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first MissionStep that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepFindFirstArgs} args - Arguments to find a MissionStep
     * @example
     * // Get one MissionStep
     * const missionStep = await prisma.missionStep.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MissionStepFindFirstArgs>(args?: SelectSubset<T, MissionStepFindFirstArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first MissionStep that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepFindFirstOrThrowArgs} args - Arguments to find a MissionStep
     * @example
     * // Get one MissionStep
     * const missionStep = await prisma.missionStep.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MissionStepFindFirstOrThrowArgs>(args?: SelectSubset<T, MissionStepFindFirstOrThrowArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more MissionSteps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all MissionSteps
     * const missionSteps = await prisma.missionStep.findMany()
     * 
     * // Get first 10 MissionSteps
     * const missionSteps = await prisma.missionStep.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const missionStepWithIdOnly = await prisma.missionStep.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MissionStepFindManyArgs>(args?: SelectSubset<T, MissionStepFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a MissionStep.
     * @param {MissionStepCreateArgs} args - Arguments to create a MissionStep.
     * @example
     * // Create one MissionStep
     * const MissionStep = await prisma.missionStep.create({
     *   data: {
     *     // ... data to create a MissionStep
     *   }
     * })
     * 
     */
    create<T extends MissionStepCreateArgs>(args: SelectSubset<T, MissionStepCreateArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many MissionSteps.
     * @param {MissionStepCreateManyArgs} args - Arguments to create many MissionSteps.
     * @example
     * // Create many MissionSteps
     * const missionStep = await prisma.missionStep.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MissionStepCreateManyArgs>(args?: SelectSubset<T, MissionStepCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many MissionSteps and returns the data saved in the database.
     * @param {MissionStepCreateManyAndReturnArgs} args - Arguments to create many MissionSteps.
     * @example
     * // Create many MissionSteps
     * const missionStep = await prisma.missionStep.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many MissionSteps and only return the `id`
     * const missionStepWithIdOnly = await prisma.missionStep.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MissionStepCreateManyAndReturnArgs>(args?: SelectSubset<T, MissionStepCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a MissionStep.
     * @param {MissionStepDeleteArgs} args - Arguments to delete one MissionStep.
     * @example
     * // Delete one MissionStep
     * const MissionStep = await prisma.missionStep.delete({
     *   where: {
     *     // ... filter to delete one MissionStep
     *   }
     * })
     * 
     */
    delete<T extends MissionStepDeleteArgs>(args: SelectSubset<T, MissionStepDeleteArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one MissionStep.
     * @param {MissionStepUpdateArgs} args - Arguments to update one MissionStep.
     * @example
     * // Update one MissionStep
     * const missionStep = await prisma.missionStep.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MissionStepUpdateArgs>(args: SelectSubset<T, MissionStepUpdateArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more MissionSteps.
     * @param {MissionStepDeleteManyArgs} args - Arguments to filter MissionSteps to delete.
     * @example
     * // Delete a few MissionSteps
     * const { count } = await prisma.missionStep.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MissionStepDeleteManyArgs>(args?: SelectSubset<T, MissionStepDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MissionSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many MissionSteps
     * const missionStep = await prisma.missionStep.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MissionStepUpdateManyArgs>(args: SelectSubset<T, MissionStepUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one MissionStep.
     * @param {MissionStepUpsertArgs} args - Arguments to update or create a MissionStep.
     * @example
     * // Update or create a MissionStep
     * const missionStep = await prisma.missionStep.upsert({
     *   create: {
     *     // ... data to create a MissionStep
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the MissionStep we want to update
     *   }
     * })
     */
    upsert<T extends MissionStepUpsertArgs>(args: SelectSubset<T, MissionStepUpsertArgs<ExtArgs>>): Prisma__MissionStepClient<$Result.GetResult<Prisma.$MissionStepPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of MissionSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepCountArgs} args - Arguments to filter MissionSteps to count.
     * @example
     * // Count the number of MissionSteps
     * const count = await prisma.missionStep.count({
     *   where: {
     *     // ... the filter for the MissionSteps we want to count
     *   }
     * })
    **/
    count<T extends MissionStepCountArgs>(
      args?: Subset<T, MissionStepCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MissionStepCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a MissionStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MissionStepAggregateArgs>(args: Subset<T, MissionStepAggregateArgs>): Prisma.PrismaPromise<GetMissionStepAggregateType<T>>

    /**
     * Group by MissionStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MissionStepGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MissionStepGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MissionStepGroupByArgs['orderBy'] }
        : { orderBy?: MissionStepGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MissionStepGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMissionStepGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the MissionStep model
   */
  readonly fields: MissionStepFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for MissionStep.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MissionStepClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    mission<T extends MissionDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MissionDefaultArgs<ExtArgs>>): Prisma__MissionClient<$Result.GetResult<Prisma.$MissionPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the MissionStep model
   */ 
  interface MissionStepFieldRefs {
    readonly id: FieldRef<"MissionStep", 'String'>
    readonly missionId: FieldRef<"MissionStep", 'String'>
    readonly title: FieldRef<"MissionStep", 'String'>
    readonly status: FieldRef<"MissionStep", 'String'>
    readonly skillId: FieldRef<"MissionStep", 'String'>
    readonly prompt: FieldRef<"MissionStep", 'String'>
    readonly input: FieldRef<"MissionStep", 'Json'>
    readonly output: FieldRef<"MissionStep", 'Json'>
    readonly dependsOn: FieldRef<"MissionStep", 'String[]'>
    readonly retries: FieldRef<"MissionStep", 'Int'>
    readonly executor: FieldRef<"MissionStep", 'String'>
    readonly approvalGateId: FieldRef<"MissionStep", 'String'>
    readonly startedAt: FieldRef<"MissionStep", 'DateTime'>
    readonly completedAt: FieldRef<"MissionStep", 'DateTime'>
    readonly createdAt: FieldRef<"MissionStep", 'DateTime'>
    readonly updatedAt: FieldRef<"MissionStep", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * MissionStep findUnique
   */
  export type MissionStepFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter, which MissionStep to fetch.
     */
    where: MissionStepWhereUniqueInput
  }

  /**
   * MissionStep findUniqueOrThrow
   */
  export type MissionStepFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter, which MissionStep to fetch.
     */
    where: MissionStepWhereUniqueInput
  }

  /**
   * MissionStep findFirst
   */
  export type MissionStepFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter, which MissionStep to fetch.
     */
    where?: MissionStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MissionSteps to fetch.
     */
    orderBy?: MissionStepOrderByWithRelationInput | MissionStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MissionSteps.
     */
    cursor?: MissionStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MissionSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MissionSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MissionSteps.
     */
    distinct?: MissionStepScalarFieldEnum | MissionStepScalarFieldEnum[]
  }

  /**
   * MissionStep findFirstOrThrow
   */
  export type MissionStepFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter, which MissionStep to fetch.
     */
    where?: MissionStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MissionSteps to fetch.
     */
    orderBy?: MissionStepOrderByWithRelationInput | MissionStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MissionSteps.
     */
    cursor?: MissionStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MissionSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MissionSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MissionSteps.
     */
    distinct?: MissionStepScalarFieldEnum | MissionStepScalarFieldEnum[]
  }

  /**
   * MissionStep findMany
   */
  export type MissionStepFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter, which MissionSteps to fetch.
     */
    where?: MissionStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MissionSteps to fetch.
     */
    orderBy?: MissionStepOrderByWithRelationInput | MissionStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing MissionSteps.
     */
    cursor?: MissionStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MissionSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MissionSteps.
     */
    skip?: number
    distinct?: MissionStepScalarFieldEnum | MissionStepScalarFieldEnum[]
  }

  /**
   * MissionStep create
   */
  export type MissionStepCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * The data needed to create a MissionStep.
     */
    data: XOR<MissionStepCreateInput, MissionStepUncheckedCreateInput>
  }

  /**
   * MissionStep createMany
   */
  export type MissionStepCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many MissionSteps.
     */
    data: MissionStepCreateManyInput | MissionStepCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * MissionStep createManyAndReturn
   */
  export type MissionStepCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many MissionSteps.
     */
    data: MissionStepCreateManyInput | MissionStepCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * MissionStep update
   */
  export type MissionStepUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * The data needed to update a MissionStep.
     */
    data: XOR<MissionStepUpdateInput, MissionStepUncheckedUpdateInput>
    /**
     * Choose, which MissionStep to update.
     */
    where: MissionStepWhereUniqueInput
  }

  /**
   * MissionStep updateMany
   */
  export type MissionStepUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update MissionSteps.
     */
    data: XOR<MissionStepUpdateManyMutationInput, MissionStepUncheckedUpdateManyInput>
    /**
     * Filter which MissionSteps to update
     */
    where?: MissionStepWhereInput
  }

  /**
   * MissionStep upsert
   */
  export type MissionStepUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * The filter to search for the MissionStep to update in case it exists.
     */
    where: MissionStepWhereUniqueInput
    /**
     * In case the MissionStep found by the `where` argument doesn't exist, create a new MissionStep with this data.
     */
    create: XOR<MissionStepCreateInput, MissionStepUncheckedCreateInput>
    /**
     * In case the MissionStep was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MissionStepUpdateInput, MissionStepUncheckedUpdateInput>
  }

  /**
   * MissionStep delete
   */
  export type MissionStepDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
    /**
     * Filter which MissionStep to delete.
     */
    where: MissionStepWhereUniqueInput
  }

  /**
   * MissionStep deleteMany
   */
  export type MissionStepDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MissionSteps to delete
     */
    where?: MissionStepWhereInput
  }

  /**
   * MissionStep without action
   */
  export type MissionStepDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MissionStep
     */
    select?: MissionStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MissionStepInclude<ExtArgs> | null
  }


  /**
   * Model MemoryMeta
   */

  export type AggregateMemoryMeta = {
    _count: MemoryMetaCountAggregateOutputType | null
    _avg: MemoryMetaAvgAggregateOutputType | null
    _sum: MemoryMetaSumAggregateOutputType | null
    _min: MemoryMetaMinAggregateOutputType | null
    _max: MemoryMetaMaxAggregateOutputType | null
  }

  export type MemoryMetaAvgAggregateOutputType = {
    accessCount: number | null
    confidence: number | null
  }

  export type MemoryMetaSumAggregateOutputType = {
    accessCount: number | null
    confidence: number | null
  }

  export type MemoryMetaMinAggregateOutputType = {
    id: string | null
    v1DocumentId: string | null
    projectId: string | null
    memoryClass: string | null
    accessCount: number | null
    lastAccessAt: Date | null
    consolidatedInto: string | null
    memoryType: string | null
    confidence: number | null
    validUntil: Date | null
    missionId: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MemoryMetaMaxAggregateOutputType = {
    id: string | null
    v1DocumentId: string | null
    projectId: string | null
    memoryClass: string | null
    accessCount: number | null
    lastAccessAt: Date | null
    consolidatedInto: string | null
    memoryType: string | null
    confidence: number | null
    validUntil: Date | null
    missionId: string | null
    notes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MemoryMetaCountAggregateOutputType = {
    id: number
    v1DocumentId: number
    projectId: number
    memoryClass: number
    accessCount: number
    lastAccessAt: number
    consolidatedInto: number
    memoryType: number
    confidence: number
    validUntil: number
    missionId: number
    notes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type MemoryMetaAvgAggregateInputType = {
    accessCount?: true
    confidence?: true
  }

  export type MemoryMetaSumAggregateInputType = {
    accessCount?: true
    confidence?: true
  }

  export type MemoryMetaMinAggregateInputType = {
    id?: true
    v1DocumentId?: true
    projectId?: true
    memoryClass?: true
    accessCount?: true
    lastAccessAt?: true
    consolidatedInto?: true
    memoryType?: true
    confidence?: true
    validUntil?: true
    missionId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MemoryMetaMaxAggregateInputType = {
    id?: true
    v1DocumentId?: true
    projectId?: true
    memoryClass?: true
    accessCount?: true
    lastAccessAt?: true
    consolidatedInto?: true
    memoryType?: true
    confidence?: true
    validUntil?: true
    missionId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MemoryMetaCountAggregateInputType = {
    id?: true
    v1DocumentId?: true
    projectId?: true
    memoryClass?: true
    accessCount?: true
    lastAccessAt?: true
    consolidatedInto?: true
    memoryType?: true
    confidence?: true
    validUntil?: true
    missionId?: true
    notes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MemoryMetaAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MemoryMeta to aggregate.
     */
    where?: MemoryMetaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MemoryMetas to fetch.
     */
    orderBy?: MemoryMetaOrderByWithRelationInput | MemoryMetaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MemoryMetaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MemoryMetas from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MemoryMetas.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned MemoryMetas
    **/
    _count?: true | MemoryMetaCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MemoryMetaAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MemoryMetaSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MemoryMetaMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MemoryMetaMaxAggregateInputType
  }

  export type GetMemoryMetaAggregateType<T extends MemoryMetaAggregateArgs> = {
        [P in keyof T & keyof AggregateMemoryMeta]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMemoryMeta[P]>
      : GetScalarType<T[P], AggregateMemoryMeta[P]>
  }




  export type MemoryMetaGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MemoryMetaWhereInput
    orderBy?: MemoryMetaOrderByWithAggregationInput | MemoryMetaOrderByWithAggregationInput[]
    by: MemoryMetaScalarFieldEnum[] | MemoryMetaScalarFieldEnum
    having?: MemoryMetaScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MemoryMetaCountAggregateInputType | true
    _avg?: MemoryMetaAvgAggregateInputType
    _sum?: MemoryMetaSumAggregateInputType
    _min?: MemoryMetaMinAggregateInputType
    _max?: MemoryMetaMaxAggregateInputType
  }

  export type MemoryMetaGroupByOutputType = {
    id: string
    v1DocumentId: string
    projectId: string
    memoryClass: string
    accessCount: number
    lastAccessAt: Date | null
    consolidatedInto: string | null
    memoryType: string | null
    confidence: number | null
    validUntil: Date | null
    missionId: string | null
    notes: string | null
    createdAt: Date
    updatedAt: Date
    _count: MemoryMetaCountAggregateOutputType | null
    _avg: MemoryMetaAvgAggregateOutputType | null
    _sum: MemoryMetaSumAggregateOutputType | null
    _min: MemoryMetaMinAggregateOutputType | null
    _max: MemoryMetaMaxAggregateOutputType | null
  }

  type GetMemoryMetaGroupByPayload<T extends MemoryMetaGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MemoryMetaGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MemoryMetaGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MemoryMetaGroupByOutputType[P]>
            : GetScalarType<T[P], MemoryMetaGroupByOutputType[P]>
        }
      >
    >


  export type MemoryMetaSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    v1DocumentId?: boolean
    projectId?: boolean
    memoryClass?: boolean
    accessCount?: boolean
    lastAccessAt?: boolean
    consolidatedInto?: boolean
    memoryType?: boolean
    confidence?: boolean
    validUntil?: boolean
    missionId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["memoryMeta"]>

  export type MemoryMetaSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    v1DocumentId?: boolean
    projectId?: boolean
    memoryClass?: boolean
    accessCount?: boolean
    lastAccessAt?: boolean
    consolidatedInto?: boolean
    memoryType?: boolean
    confidence?: boolean
    validUntil?: boolean
    missionId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["memoryMeta"]>

  export type MemoryMetaSelectScalar = {
    id?: boolean
    v1DocumentId?: boolean
    projectId?: boolean
    memoryClass?: boolean
    accessCount?: boolean
    lastAccessAt?: boolean
    consolidatedInto?: boolean
    memoryType?: boolean
    confidence?: boolean
    validUntil?: boolean
    missionId?: boolean
    notes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $MemoryMetaPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "MemoryMeta"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      v1DocumentId: string
      projectId: string
      memoryClass: string
      accessCount: number
      lastAccessAt: Date | null
      consolidatedInto: string | null
      memoryType: string | null
      confidence: number | null
      validUntil: Date | null
      missionId: string | null
      notes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["memoryMeta"]>
    composites: {}
  }

  type MemoryMetaGetPayload<S extends boolean | null | undefined | MemoryMetaDefaultArgs> = $Result.GetResult<Prisma.$MemoryMetaPayload, S>

  type MemoryMetaCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<MemoryMetaFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: MemoryMetaCountAggregateInputType | true
    }

  export interface MemoryMetaDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['MemoryMeta'], meta: { name: 'MemoryMeta' } }
    /**
     * Find zero or one MemoryMeta that matches the filter.
     * @param {MemoryMetaFindUniqueArgs} args - Arguments to find a MemoryMeta
     * @example
     * // Get one MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MemoryMetaFindUniqueArgs>(args: SelectSubset<T, MemoryMetaFindUniqueArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one MemoryMeta that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {MemoryMetaFindUniqueOrThrowArgs} args - Arguments to find a MemoryMeta
     * @example
     * // Get one MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MemoryMetaFindUniqueOrThrowArgs>(args: SelectSubset<T, MemoryMetaFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first MemoryMeta that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaFindFirstArgs} args - Arguments to find a MemoryMeta
     * @example
     * // Get one MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MemoryMetaFindFirstArgs>(args?: SelectSubset<T, MemoryMetaFindFirstArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first MemoryMeta that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaFindFirstOrThrowArgs} args - Arguments to find a MemoryMeta
     * @example
     * // Get one MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MemoryMetaFindFirstOrThrowArgs>(args?: SelectSubset<T, MemoryMetaFindFirstOrThrowArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more MemoryMetas that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all MemoryMetas
     * const memoryMetas = await prisma.memoryMeta.findMany()
     * 
     * // Get first 10 MemoryMetas
     * const memoryMetas = await prisma.memoryMeta.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const memoryMetaWithIdOnly = await prisma.memoryMeta.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MemoryMetaFindManyArgs>(args?: SelectSubset<T, MemoryMetaFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a MemoryMeta.
     * @param {MemoryMetaCreateArgs} args - Arguments to create a MemoryMeta.
     * @example
     * // Create one MemoryMeta
     * const MemoryMeta = await prisma.memoryMeta.create({
     *   data: {
     *     // ... data to create a MemoryMeta
     *   }
     * })
     * 
     */
    create<T extends MemoryMetaCreateArgs>(args: SelectSubset<T, MemoryMetaCreateArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many MemoryMetas.
     * @param {MemoryMetaCreateManyArgs} args - Arguments to create many MemoryMetas.
     * @example
     * // Create many MemoryMetas
     * const memoryMeta = await prisma.memoryMeta.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MemoryMetaCreateManyArgs>(args?: SelectSubset<T, MemoryMetaCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many MemoryMetas and returns the data saved in the database.
     * @param {MemoryMetaCreateManyAndReturnArgs} args - Arguments to create many MemoryMetas.
     * @example
     * // Create many MemoryMetas
     * const memoryMeta = await prisma.memoryMeta.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many MemoryMetas and only return the `id`
     * const memoryMetaWithIdOnly = await prisma.memoryMeta.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MemoryMetaCreateManyAndReturnArgs>(args?: SelectSubset<T, MemoryMetaCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a MemoryMeta.
     * @param {MemoryMetaDeleteArgs} args - Arguments to delete one MemoryMeta.
     * @example
     * // Delete one MemoryMeta
     * const MemoryMeta = await prisma.memoryMeta.delete({
     *   where: {
     *     // ... filter to delete one MemoryMeta
     *   }
     * })
     * 
     */
    delete<T extends MemoryMetaDeleteArgs>(args: SelectSubset<T, MemoryMetaDeleteArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one MemoryMeta.
     * @param {MemoryMetaUpdateArgs} args - Arguments to update one MemoryMeta.
     * @example
     * // Update one MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MemoryMetaUpdateArgs>(args: SelectSubset<T, MemoryMetaUpdateArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more MemoryMetas.
     * @param {MemoryMetaDeleteManyArgs} args - Arguments to filter MemoryMetas to delete.
     * @example
     * // Delete a few MemoryMetas
     * const { count } = await prisma.memoryMeta.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MemoryMetaDeleteManyArgs>(args?: SelectSubset<T, MemoryMetaDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MemoryMetas.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many MemoryMetas
     * const memoryMeta = await prisma.memoryMeta.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MemoryMetaUpdateManyArgs>(args: SelectSubset<T, MemoryMetaUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one MemoryMeta.
     * @param {MemoryMetaUpsertArgs} args - Arguments to update or create a MemoryMeta.
     * @example
     * // Update or create a MemoryMeta
     * const memoryMeta = await prisma.memoryMeta.upsert({
     *   create: {
     *     // ... data to create a MemoryMeta
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the MemoryMeta we want to update
     *   }
     * })
     */
    upsert<T extends MemoryMetaUpsertArgs>(args: SelectSubset<T, MemoryMetaUpsertArgs<ExtArgs>>): Prisma__MemoryMetaClient<$Result.GetResult<Prisma.$MemoryMetaPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of MemoryMetas.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaCountArgs} args - Arguments to filter MemoryMetas to count.
     * @example
     * // Count the number of MemoryMetas
     * const count = await prisma.memoryMeta.count({
     *   where: {
     *     // ... the filter for the MemoryMetas we want to count
     *   }
     * })
    **/
    count<T extends MemoryMetaCountArgs>(
      args?: Subset<T, MemoryMetaCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MemoryMetaCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a MemoryMeta.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MemoryMetaAggregateArgs>(args: Subset<T, MemoryMetaAggregateArgs>): Prisma.PrismaPromise<GetMemoryMetaAggregateType<T>>

    /**
     * Group by MemoryMeta.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MemoryMetaGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MemoryMetaGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MemoryMetaGroupByArgs['orderBy'] }
        : { orderBy?: MemoryMetaGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MemoryMetaGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMemoryMetaGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the MemoryMeta model
   */
  readonly fields: MemoryMetaFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for MemoryMeta.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MemoryMetaClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the MemoryMeta model
   */ 
  interface MemoryMetaFieldRefs {
    readonly id: FieldRef<"MemoryMeta", 'String'>
    readonly v1DocumentId: FieldRef<"MemoryMeta", 'String'>
    readonly projectId: FieldRef<"MemoryMeta", 'String'>
    readonly memoryClass: FieldRef<"MemoryMeta", 'String'>
    readonly accessCount: FieldRef<"MemoryMeta", 'Int'>
    readonly lastAccessAt: FieldRef<"MemoryMeta", 'DateTime'>
    readonly consolidatedInto: FieldRef<"MemoryMeta", 'String'>
    readonly memoryType: FieldRef<"MemoryMeta", 'String'>
    readonly confidence: FieldRef<"MemoryMeta", 'Float'>
    readonly validUntil: FieldRef<"MemoryMeta", 'DateTime'>
    readonly missionId: FieldRef<"MemoryMeta", 'String'>
    readonly notes: FieldRef<"MemoryMeta", 'String'>
    readonly createdAt: FieldRef<"MemoryMeta", 'DateTime'>
    readonly updatedAt: FieldRef<"MemoryMeta", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * MemoryMeta findUnique
   */
  export type MemoryMetaFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter, which MemoryMeta to fetch.
     */
    where: MemoryMetaWhereUniqueInput
  }

  /**
   * MemoryMeta findUniqueOrThrow
   */
  export type MemoryMetaFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter, which MemoryMeta to fetch.
     */
    where: MemoryMetaWhereUniqueInput
  }

  /**
   * MemoryMeta findFirst
   */
  export type MemoryMetaFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter, which MemoryMeta to fetch.
     */
    where?: MemoryMetaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MemoryMetas to fetch.
     */
    orderBy?: MemoryMetaOrderByWithRelationInput | MemoryMetaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MemoryMetas.
     */
    cursor?: MemoryMetaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MemoryMetas from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MemoryMetas.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MemoryMetas.
     */
    distinct?: MemoryMetaScalarFieldEnum | MemoryMetaScalarFieldEnum[]
  }

  /**
   * MemoryMeta findFirstOrThrow
   */
  export type MemoryMetaFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter, which MemoryMeta to fetch.
     */
    where?: MemoryMetaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MemoryMetas to fetch.
     */
    orderBy?: MemoryMetaOrderByWithRelationInput | MemoryMetaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MemoryMetas.
     */
    cursor?: MemoryMetaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MemoryMetas from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MemoryMetas.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MemoryMetas.
     */
    distinct?: MemoryMetaScalarFieldEnum | MemoryMetaScalarFieldEnum[]
  }

  /**
   * MemoryMeta findMany
   */
  export type MemoryMetaFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter, which MemoryMetas to fetch.
     */
    where?: MemoryMetaWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MemoryMetas to fetch.
     */
    orderBy?: MemoryMetaOrderByWithRelationInput | MemoryMetaOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing MemoryMetas.
     */
    cursor?: MemoryMetaWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MemoryMetas from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MemoryMetas.
     */
    skip?: number
    distinct?: MemoryMetaScalarFieldEnum | MemoryMetaScalarFieldEnum[]
  }

  /**
   * MemoryMeta create
   */
  export type MemoryMetaCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * The data needed to create a MemoryMeta.
     */
    data: XOR<MemoryMetaCreateInput, MemoryMetaUncheckedCreateInput>
  }

  /**
   * MemoryMeta createMany
   */
  export type MemoryMetaCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many MemoryMetas.
     */
    data: MemoryMetaCreateManyInput | MemoryMetaCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * MemoryMeta createManyAndReturn
   */
  export type MemoryMetaCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many MemoryMetas.
     */
    data: MemoryMetaCreateManyInput | MemoryMetaCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * MemoryMeta update
   */
  export type MemoryMetaUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * The data needed to update a MemoryMeta.
     */
    data: XOR<MemoryMetaUpdateInput, MemoryMetaUncheckedUpdateInput>
    /**
     * Choose, which MemoryMeta to update.
     */
    where: MemoryMetaWhereUniqueInput
  }

  /**
   * MemoryMeta updateMany
   */
  export type MemoryMetaUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update MemoryMetas.
     */
    data: XOR<MemoryMetaUpdateManyMutationInput, MemoryMetaUncheckedUpdateManyInput>
    /**
     * Filter which MemoryMetas to update
     */
    where?: MemoryMetaWhereInput
  }

  /**
   * MemoryMeta upsert
   */
  export type MemoryMetaUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * The filter to search for the MemoryMeta to update in case it exists.
     */
    where: MemoryMetaWhereUniqueInput
    /**
     * In case the MemoryMeta found by the `where` argument doesn't exist, create a new MemoryMeta with this data.
     */
    create: XOR<MemoryMetaCreateInput, MemoryMetaUncheckedCreateInput>
    /**
     * In case the MemoryMeta was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MemoryMetaUpdateInput, MemoryMetaUncheckedUpdateInput>
  }

  /**
   * MemoryMeta delete
   */
  export type MemoryMetaDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
    /**
     * Filter which MemoryMeta to delete.
     */
    where: MemoryMetaWhereUniqueInput
  }

  /**
   * MemoryMeta deleteMany
   */
  export type MemoryMetaDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MemoryMetas to delete
     */
    where?: MemoryMetaWhereInput
  }

  /**
   * MemoryMeta without action
   */
  export type MemoryMetaDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MemoryMeta
     */
    select?: MemoryMetaSelect<ExtArgs> | null
  }


  /**
   * Model VaultAccessLog
   */

  export type AggregateVaultAccessLog = {
    _count: VaultAccessLogCountAggregateOutputType | null
    _min: VaultAccessLogMinAggregateOutputType | null
    _max: VaultAccessLogMaxAggregateOutputType | null
  }

  export type VaultAccessLogMinAggregateOutputType = {
    id: string | null
    projectSlug: string | null
    key: string | null
    accessor: string | null
    missionId: string | null
    stepId: string | null
    accessedAt: Date | null
  }

  export type VaultAccessLogMaxAggregateOutputType = {
    id: string | null
    projectSlug: string | null
    key: string | null
    accessor: string | null
    missionId: string | null
    stepId: string | null
    accessedAt: Date | null
  }

  export type VaultAccessLogCountAggregateOutputType = {
    id: number
    projectSlug: number
    key: number
    accessor: number
    missionId: number
    stepId: number
    accessedAt: number
    _all: number
  }


  export type VaultAccessLogMinAggregateInputType = {
    id?: true
    projectSlug?: true
    key?: true
    accessor?: true
    missionId?: true
    stepId?: true
    accessedAt?: true
  }

  export type VaultAccessLogMaxAggregateInputType = {
    id?: true
    projectSlug?: true
    key?: true
    accessor?: true
    missionId?: true
    stepId?: true
    accessedAt?: true
  }

  export type VaultAccessLogCountAggregateInputType = {
    id?: true
    projectSlug?: true
    key?: true
    accessor?: true
    missionId?: true
    stepId?: true
    accessedAt?: true
    _all?: true
  }

  export type VaultAccessLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which VaultAccessLog to aggregate.
     */
    where?: VaultAccessLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of VaultAccessLogs to fetch.
     */
    orderBy?: VaultAccessLogOrderByWithRelationInput | VaultAccessLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: VaultAccessLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` VaultAccessLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` VaultAccessLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned VaultAccessLogs
    **/
    _count?: true | VaultAccessLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: VaultAccessLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: VaultAccessLogMaxAggregateInputType
  }

  export type GetVaultAccessLogAggregateType<T extends VaultAccessLogAggregateArgs> = {
        [P in keyof T & keyof AggregateVaultAccessLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateVaultAccessLog[P]>
      : GetScalarType<T[P], AggregateVaultAccessLog[P]>
  }




  export type VaultAccessLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: VaultAccessLogWhereInput
    orderBy?: VaultAccessLogOrderByWithAggregationInput | VaultAccessLogOrderByWithAggregationInput[]
    by: VaultAccessLogScalarFieldEnum[] | VaultAccessLogScalarFieldEnum
    having?: VaultAccessLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: VaultAccessLogCountAggregateInputType | true
    _min?: VaultAccessLogMinAggregateInputType
    _max?: VaultAccessLogMaxAggregateInputType
  }

  export type VaultAccessLogGroupByOutputType = {
    id: string
    projectSlug: string
    key: string
    accessor: string
    missionId: string | null
    stepId: string | null
    accessedAt: Date
    _count: VaultAccessLogCountAggregateOutputType | null
    _min: VaultAccessLogMinAggregateOutputType | null
    _max: VaultAccessLogMaxAggregateOutputType | null
  }

  type GetVaultAccessLogGroupByPayload<T extends VaultAccessLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<VaultAccessLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof VaultAccessLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], VaultAccessLogGroupByOutputType[P]>
            : GetScalarType<T[P], VaultAccessLogGroupByOutputType[P]>
        }
      >
    >


  export type VaultAccessLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectSlug?: boolean
    key?: boolean
    accessor?: boolean
    missionId?: boolean
    stepId?: boolean
    accessedAt?: boolean
  }, ExtArgs["result"]["vaultAccessLog"]>

  export type VaultAccessLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectSlug?: boolean
    key?: boolean
    accessor?: boolean
    missionId?: boolean
    stepId?: boolean
    accessedAt?: boolean
  }, ExtArgs["result"]["vaultAccessLog"]>

  export type VaultAccessLogSelectScalar = {
    id?: boolean
    projectSlug?: boolean
    key?: boolean
    accessor?: boolean
    missionId?: boolean
    stepId?: boolean
    accessedAt?: boolean
  }


  export type $VaultAccessLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "VaultAccessLog"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectSlug: string
      key: string
      accessor: string
      missionId: string | null
      stepId: string | null
      accessedAt: Date
    }, ExtArgs["result"]["vaultAccessLog"]>
    composites: {}
  }

  type VaultAccessLogGetPayload<S extends boolean | null | undefined | VaultAccessLogDefaultArgs> = $Result.GetResult<Prisma.$VaultAccessLogPayload, S>

  type VaultAccessLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<VaultAccessLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: VaultAccessLogCountAggregateInputType | true
    }

  export interface VaultAccessLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['VaultAccessLog'], meta: { name: 'VaultAccessLog' } }
    /**
     * Find zero or one VaultAccessLog that matches the filter.
     * @param {VaultAccessLogFindUniqueArgs} args - Arguments to find a VaultAccessLog
     * @example
     * // Get one VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends VaultAccessLogFindUniqueArgs>(args: SelectSubset<T, VaultAccessLogFindUniqueArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one VaultAccessLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {VaultAccessLogFindUniqueOrThrowArgs} args - Arguments to find a VaultAccessLog
     * @example
     * // Get one VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends VaultAccessLogFindUniqueOrThrowArgs>(args: SelectSubset<T, VaultAccessLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first VaultAccessLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogFindFirstArgs} args - Arguments to find a VaultAccessLog
     * @example
     * // Get one VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends VaultAccessLogFindFirstArgs>(args?: SelectSubset<T, VaultAccessLogFindFirstArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first VaultAccessLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogFindFirstOrThrowArgs} args - Arguments to find a VaultAccessLog
     * @example
     * // Get one VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends VaultAccessLogFindFirstOrThrowArgs>(args?: SelectSubset<T, VaultAccessLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more VaultAccessLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all VaultAccessLogs
     * const vaultAccessLogs = await prisma.vaultAccessLog.findMany()
     * 
     * // Get first 10 VaultAccessLogs
     * const vaultAccessLogs = await prisma.vaultAccessLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const vaultAccessLogWithIdOnly = await prisma.vaultAccessLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends VaultAccessLogFindManyArgs>(args?: SelectSubset<T, VaultAccessLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a VaultAccessLog.
     * @param {VaultAccessLogCreateArgs} args - Arguments to create a VaultAccessLog.
     * @example
     * // Create one VaultAccessLog
     * const VaultAccessLog = await prisma.vaultAccessLog.create({
     *   data: {
     *     // ... data to create a VaultAccessLog
     *   }
     * })
     * 
     */
    create<T extends VaultAccessLogCreateArgs>(args: SelectSubset<T, VaultAccessLogCreateArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many VaultAccessLogs.
     * @param {VaultAccessLogCreateManyArgs} args - Arguments to create many VaultAccessLogs.
     * @example
     * // Create many VaultAccessLogs
     * const vaultAccessLog = await prisma.vaultAccessLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends VaultAccessLogCreateManyArgs>(args?: SelectSubset<T, VaultAccessLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many VaultAccessLogs and returns the data saved in the database.
     * @param {VaultAccessLogCreateManyAndReturnArgs} args - Arguments to create many VaultAccessLogs.
     * @example
     * // Create many VaultAccessLogs
     * const vaultAccessLog = await prisma.vaultAccessLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many VaultAccessLogs and only return the `id`
     * const vaultAccessLogWithIdOnly = await prisma.vaultAccessLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends VaultAccessLogCreateManyAndReturnArgs>(args?: SelectSubset<T, VaultAccessLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a VaultAccessLog.
     * @param {VaultAccessLogDeleteArgs} args - Arguments to delete one VaultAccessLog.
     * @example
     * // Delete one VaultAccessLog
     * const VaultAccessLog = await prisma.vaultAccessLog.delete({
     *   where: {
     *     // ... filter to delete one VaultAccessLog
     *   }
     * })
     * 
     */
    delete<T extends VaultAccessLogDeleteArgs>(args: SelectSubset<T, VaultAccessLogDeleteArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one VaultAccessLog.
     * @param {VaultAccessLogUpdateArgs} args - Arguments to update one VaultAccessLog.
     * @example
     * // Update one VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends VaultAccessLogUpdateArgs>(args: SelectSubset<T, VaultAccessLogUpdateArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more VaultAccessLogs.
     * @param {VaultAccessLogDeleteManyArgs} args - Arguments to filter VaultAccessLogs to delete.
     * @example
     * // Delete a few VaultAccessLogs
     * const { count } = await prisma.vaultAccessLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends VaultAccessLogDeleteManyArgs>(args?: SelectSubset<T, VaultAccessLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more VaultAccessLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many VaultAccessLogs
     * const vaultAccessLog = await prisma.vaultAccessLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends VaultAccessLogUpdateManyArgs>(args: SelectSubset<T, VaultAccessLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one VaultAccessLog.
     * @param {VaultAccessLogUpsertArgs} args - Arguments to update or create a VaultAccessLog.
     * @example
     * // Update or create a VaultAccessLog
     * const vaultAccessLog = await prisma.vaultAccessLog.upsert({
     *   create: {
     *     // ... data to create a VaultAccessLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the VaultAccessLog we want to update
     *   }
     * })
     */
    upsert<T extends VaultAccessLogUpsertArgs>(args: SelectSubset<T, VaultAccessLogUpsertArgs<ExtArgs>>): Prisma__VaultAccessLogClient<$Result.GetResult<Prisma.$VaultAccessLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of VaultAccessLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogCountArgs} args - Arguments to filter VaultAccessLogs to count.
     * @example
     * // Count the number of VaultAccessLogs
     * const count = await prisma.vaultAccessLog.count({
     *   where: {
     *     // ... the filter for the VaultAccessLogs we want to count
     *   }
     * })
    **/
    count<T extends VaultAccessLogCountArgs>(
      args?: Subset<T, VaultAccessLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], VaultAccessLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a VaultAccessLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends VaultAccessLogAggregateArgs>(args: Subset<T, VaultAccessLogAggregateArgs>): Prisma.PrismaPromise<GetVaultAccessLogAggregateType<T>>

    /**
     * Group by VaultAccessLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {VaultAccessLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends VaultAccessLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: VaultAccessLogGroupByArgs['orderBy'] }
        : { orderBy?: VaultAccessLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, VaultAccessLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetVaultAccessLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the VaultAccessLog model
   */
  readonly fields: VaultAccessLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for VaultAccessLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__VaultAccessLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the VaultAccessLog model
   */ 
  interface VaultAccessLogFieldRefs {
    readonly id: FieldRef<"VaultAccessLog", 'String'>
    readonly projectSlug: FieldRef<"VaultAccessLog", 'String'>
    readonly key: FieldRef<"VaultAccessLog", 'String'>
    readonly accessor: FieldRef<"VaultAccessLog", 'String'>
    readonly missionId: FieldRef<"VaultAccessLog", 'String'>
    readonly stepId: FieldRef<"VaultAccessLog", 'String'>
    readonly accessedAt: FieldRef<"VaultAccessLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * VaultAccessLog findUnique
   */
  export type VaultAccessLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter, which VaultAccessLog to fetch.
     */
    where: VaultAccessLogWhereUniqueInput
  }

  /**
   * VaultAccessLog findUniqueOrThrow
   */
  export type VaultAccessLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter, which VaultAccessLog to fetch.
     */
    where: VaultAccessLogWhereUniqueInput
  }

  /**
   * VaultAccessLog findFirst
   */
  export type VaultAccessLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter, which VaultAccessLog to fetch.
     */
    where?: VaultAccessLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of VaultAccessLogs to fetch.
     */
    orderBy?: VaultAccessLogOrderByWithRelationInput | VaultAccessLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for VaultAccessLogs.
     */
    cursor?: VaultAccessLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` VaultAccessLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` VaultAccessLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of VaultAccessLogs.
     */
    distinct?: VaultAccessLogScalarFieldEnum | VaultAccessLogScalarFieldEnum[]
  }

  /**
   * VaultAccessLog findFirstOrThrow
   */
  export type VaultAccessLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter, which VaultAccessLog to fetch.
     */
    where?: VaultAccessLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of VaultAccessLogs to fetch.
     */
    orderBy?: VaultAccessLogOrderByWithRelationInput | VaultAccessLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for VaultAccessLogs.
     */
    cursor?: VaultAccessLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` VaultAccessLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` VaultAccessLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of VaultAccessLogs.
     */
    distinct?: VaultAccessLogScalarFieldEnum | VaultAccessLogScalarFieldEnum[]
  }

  /**
   * VaultAccessLog findMany
   */
  export type VaultAccessLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter, which VaultAccessLogs to fetch.
     */
    where?: VaultAccessLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of VaultAccessLogs to fetch.
     */
    orderBy?: VaultAccessLogOrderByWithRelationInput | VaultAccessLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing VaultAccessLogs.
     */
    cursor?: VaultAccessLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` VaultAccessLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` VaultAccessLogs.
     */
    skip?: number
    distinct?: VaultAccessLogScalarFieldEnum | VaultAccessLogScalarFieldEnum[]
  }

  /**
   * VaultAccessLog create
   */
  export type VaultAccessLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * The data needed to create a VaultAccessLog.
     */
    data: XOR<VaultAccessLogCreateInput, VaultAccessLogUncheckedCreateInput>
  }

  /**
   * VaultAccessLog createMany
   */
  export type VaultAccessLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many VaultAccessLogs.
     */
    data: VaultAccessLogCreateManyInput | VaultAccessLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * VaultAccessLog createManyAndReturn
   */
  export type VaultAccessLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many VaultAccessLogs.
     */
    data: VaultAccessLogCreateManyInput | VaultAccessLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * VaultAccessLog update
   */
  export type VaultAccessLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * The data needed to update a VaultAccessLog.
     */
    data: XOR<VaultAccessLogUpdateInput, VaultAccessLogUncheckedUpdateInput>
    /**
     * Choose, which VaultAccessLog to update.
     */
    where: VaultAccessLogWhereUniqueInput
  }

  /**
   * VaultAccessLog updateMany
   */
  export type VaultAccessLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update VaultAccessLogs.
     */
    data: XOR<VaultAccessLogUpdateManyMutationInput, VaultAccessLogUncheckedUpdateManyInput>
    /**
     * Filter which VaultAccessLogs to update
     */
    where?: VaultAccessLogWhereInput
  }

  /**
   * VaultAccessLog upsert
   */
  export type VaultAccessLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * The filter to search for the VaultAccessLog to update in case it exists.
     */
    where: VaultAccessLogWhereUniqueInput
    /**
     * In case the VaultAccessLog found by the `where` argument doesn't exist, create a new VaultAccessLog with this data.
     */
    create: XOR<VaultAccessLogCreateInput, VaultAccessLogUncheckedCreateInput>
    /**
     * In case the VaultAccessLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<VaultAccessLogUpdateInput, VaultAccessLogUncheckedUpdateInput>
  }

  /**
   * VaultAccessLog delete
   */
  export type VaultAccessLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
    /**
     * Filter which VaultAccessLog to delete.
     */
    where: VaultAccessLogWhereUniqueInput
  }

  /**
   * VaultAccessLog deleteMany
   */
  export type VaultAccessLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which VaultAccessLogs to delete
     */
    where?: VaultAccessLogWhereInput
  }

  /**
   * VaultAccessLog without action
   */
  export type VaultAccessLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the VaultAccessLog
     */
    select?: VaultAccessLogSelect<ExtArgs> | null
  }


  /**
   * Model KnowledgeNode
   */

  export type AggregateKnowledgeNode = {
    _count: KnowledgeNodeCountAggregateOutputType | null
    _min: KnowledgeNodeMinAggregateOutputType | null
    _max: KnowledgeNodeMaxAggregateOutputType | null
  }

  export type KnowledgeNodeMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    type: string | null
    label: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type KnowledgeNodeMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    type: string | null
    label: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type KnowledgeNodeCountAggregateOutputType = {
    id: number
    projectId: number
    type: number
    label: number
    description: number
    metadata: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type KnowledgeNodeMinAggregateInputType = {
    id?: true
    projectId?: true
    type?: true
    label?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type KnowledgeNodeMaxAggregateInputType = {
    id?: true
    projectId?: true
    type?: true
    label?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type KnowledgeNodeCountAggregateInputType = {
    id?: true
    projectId?: true
    type?: true
    label?: true
    description?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type KnowledgeNodeAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeNode to aggregate.
     */
    where?: KnowledgeNodeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeNodes to fetch.
     */
    orderBy?: KnowledgeNodeOrderByWithRelationInput | KnowledgeNodeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeNodeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeNodes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeNodes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeNodes
    **/
    _count?: true | KnowledgeNodeCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeNodeMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeNodeMaxAggregateInputType
  }

  export type GetKnowledgeNodeAggregateType<T extends KnowledgeNodeAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeNode]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeNode[P]>
      : GetScalarType<T[P], AggregateKnowledgeNode[P]>
  }




  export type KnowledgeNodeGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeNodeWhereInput
    orderBy?: KnowledgeNodeOrderByWithAggregationInput | KnowledgeNodeOrderByWithAggregationInput[]
    by: KnowledgeNodeScalarFieldEnum[] | KnowledgeNodeScalarFieldEnum
    having?: KnowledgeNodeScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeNodeCountAggregateInputType | true
    _min?: KnowledgeNodeMinAggregateInputType
    _max?: KnowledgeNodeMaxAggregateInputType
  }

  export type KnowledgeNodeGroupByOutputType = {
    id: string
    projectId: string
    type: string
    label: string
    description: string | null
    metadata: JsonValue
    createdAt: Date
    updatedAt: Date
    _count: KnowledgeNodeCountAggregateOutputType | null
    _min: KnowledgeNodeMinAggregateOutputType | null
    _max: KnowledgeNodeMaxAggregateOutputType | null
  }

  type GetKnowledgeNodeGroupByPayload<T extends KnowledgeNodeGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeNodeGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeNodeGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeNodeGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeNodeGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeNodeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    type?: boolean
    label?: boolean
    description?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    outEdges?: boolean | KnowledgeNode$outEdgesArgs<ExtArgs>
    inEdges?: boolean | KnowledgeNode$inEdgesArgs<ExtArgs>
    _count?: boolean | KnowledgeNodeCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeNode"]>

  export type KnowledgeNodeSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    type?: boolean
    label?: boolean
    description?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["knowledgeNode"]>

  export type KnowledgeNodeSelectScalar = {
    id?: boolean
    projectId?: boolean
    type?: boolean
    label?: boolean
    description?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type KnowledgeNodeInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    outEdges?: boolean | KnowledgeNode$outEdgesArgs<ExtArgs>
    inEdges?: boolean | KnowledgeNode$inEdgesArgs<ExtArgs>
    _count?: boolean | KnowledgeNodeCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type KnowledgeNodeIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $KnowledgeNodePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeNode"
    objects: {
      outEdges: Prisma.$KnowledgeEdgePayload<ExtArgs>[]
      inEdges: Prisma.$KnowledgeEdgePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      type: string
      label: string
      description: string | null
      metadata: Prisma.JsonValue
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["knowledgeNode"]>
    composites: {}
  }

  type KnowledgeNodeGetPayload<S extends boolean | null | undefined | KnowledgeNodeDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeNodePayload, S>

  type KnowledgeNodeCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeNodeFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeNodeCountAggregateInputType | true
    }

  export interface KnowledgeNodeDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeNode'], meta: { name: 'KnowledgeNode' } }
    /**
     * Find zero or one KnowledgeNode that matches the filter.
     * @param {KnowledgeNodeFindUniqueArgs} args - Arguments to find a KnowledgeNode
     * @example
     * // Get one KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeNodeFindUniqueArgs>(args: SelectSubset<T, KnowledgeNodeFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeNode that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeNodeFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeNode
     * @example
     * // Get one KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeNodeFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeNodeFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeNode that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeFindFirstArgs} args - Arguments to find a KnowledgeNode
     * @example
     * // Get one KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeNodeFindFirstArgs>(args?: SelectSubset<T, KnowledgeNodeFindFirstArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeNode that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeFindFirstOrThrowArgs} args - Arguments to find a KnowledgeNode
     * @example
     * // Get one KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeNodeFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeNodeFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeNodes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeNodes
     * const knowledgeNodes = await prisma.knowledgeNode.findMany()
     * 
     * // Get first 10 KnowledgeNodes
     * const knowledgeNodes = await prisma.knowledgeNode.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeNodeWithIdOnly = await prisma.knowledgeNode.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeNodeFindManyArgs>(args?: SelectSubset<T, KnowledgeNodeFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeNode.
     * @param {KnowledgeNodeCreateArgs} args - Arguments to create a KnowledgeNode.
     * @example
     * // Create one KnowledgeNode
     * const KnowledgeNode = await prisma.knowledgeNode.create({
     *   data: {
     *     // ... data to create a KnowledgeNode
     *   }
     * })
     * 
     */
    create<T extends KnowledgeNodeCreateArgs>(args: SelectSubset<T, KnowledgeNodeCreateArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeNodes.
     * @param {KnowledgeNodeCreateManyArgs} args - Arguments to create many KnowledgeNodes.
     * @example
     * // Create many KnowledgeNodes
     * const knowledgeNode = await prisma.knowledgeNode.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeNodeCreateManyArgs>(args?: SelectSubset<T, KnowledgeNodeCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeNodes and returns the data saved in the database.
     * @param {KnowledgeNodeCreateManyAndReturnArgs} args - Arguments to create many KnowledgeNodes.
     * @example
     * // Create many KnowledgeNodes
     * const knowledgeNode = await prisma.knowledgeNode.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeNodes and only return the `id`
     * const knowledgeNodeWithIdOnly = await prisma.knowledgeNode.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeNodeCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeNodeCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeNode.
     * @param {KnowledgeNodeDeleteArgs} args - Arguments to delete one KnowledgeNode.
     * @example
     * // Delete one KnowledgeNode
     * const KnowledgeNode = await prisma.knowledgeNode.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeNode
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeNodeDeleteArgs>(args: SelectSubset<T, KnowledgeNodeDeleteArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeNode.
     * @param {KnowledgeNodeUpdateArgs} args - Arguments to update one KnowledgeNode.
     * @example
     * // Update one KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeNodeUpdateArgs>(args: SelectSubset<T, KnowledgeNodeUpdateArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeNodes.
     * @param {KnowledgeNodeDeleteManyArgs} args - Arguments to filter KnowledgeNodes to delete.
     * @example
     * // Delete a few KnowledgeNodes
     * const { count } = await prisma.knowledgeNode.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeNodeDeleteManyArgs>(args?: SelectSubset<T, KnowledgeNodeDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeNodes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeNodes
     * const knowledgeNode = await prisma.knowledgeNode.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeNodeUpdateManyArgs>(args: SelectSubset<T, KnowledgeNodeUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeNode.
     * @param {KnowledgeNodeUpsertArgs} args - Arguments to update or create a KnowledgeNode.
     * @example
     * // Update or create a KnowledgeNode
     * const knowledgeNode = await prisma.knowledgeNode.upsert({
     *   create: {
     *     // ... data to create a KnowledgeNode
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeNode we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeNodeUpsertArgs>(args: SelectSubset<T, KnowledgeNodeUpsertArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeNodes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeCountArgs} args - Arguments to filter KnowledgeNodes to count.
     * @example
     * // Count the number of KnowledgeNodes
     * const count = await prisma.knowledgeNode.count({
     *   where: {
     *     // ... the filter for the KnowledgeNodes we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeNodeCountArgs>(
      args?: Subset<T, KnowledgeNodeCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeNodeCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeNode.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends KnowledgeNodeAggregateArgs>(args: Subset<T, KnowledgeNodeAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeNodeAggregateType<T>>

    /**
     * Group by KnowledgeNode.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeNodeGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends KnowledgeNodeGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeNodeGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeNodeGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, KnowledgeNodeGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeNodeGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeNode model
   */
  readonly fields: KnowledgeNodeFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeNode.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeNodeClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    outEdges<T extends KnowledgeNode$outEdgesArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeNode$outEdgesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findMany"> | Null>
    inEdges<T extends KnowledgeNode$inEdgesArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeNode$inEdgesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the KnowledgeNode model
   */ 
  interface KnowledgeNodeFieldRefs {
    readonly id: FieldRef<"KnowledgeNode", 'String'>
    readonly projectId: FieldRef<"KnowledgeNode", 'String'>
    readonly type: FieldRef<"KnowledgeNode", 'String'>
    readonly label: FieldRef<"KnowledgeNode", 'String'>
    readonly description: FieldRef<"KnowledgeNode", 'String'>
    readonly metadata: FieldRef<"KnowledgeNode", 'Json'>
    readonly createdAt: FieldRef<"KnowledgeNode", 'DateTime'>
    readonly updatedAt: FieldRef<"KnowledgeNode", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeNode findUnique
   */
  export type KnowledgeNodeFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeNode to fetch.
     */
    where: KnowledgeNodeWhereUniqueInput
  }

  /**
   * KnowledgeNode findUniqueOrThrow
   */
  export type KnowledgeNodeFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeNode to fetch.
     */
    where: KnowledgeNodeWhereUniqueInput
  }

  /**
   * KnowledgeNode findFirst
   */
  export type KnowledgeNodeFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeNode to fetch.
     */
    where?: KnowledgeNodeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeNodes to fetch.
     */
    orderBy?: KnowledgeNodeOrderByWithRelationInput | KnowledgeNodeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeNodes.
     */
    cursor?: KnowledgeNodeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeNodes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeNodes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeNodes.
     */
    distinct?: KnowledgeNodeScalarFieldEnum | KnowledgeNodeScalarFieldEnum[]
  }

  /**
   * KnowledgeNode findFirstOrThrow
   */
  export type KnowledgeNodeFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeNode to fetch.
     */
    where?: KnowledgeNodeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeNodes to fetch.
     */
    orderBy?: KnowledgeNodeOrderByWithRelationInput | KnowledgeNodeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeNodes.
     */
    cursor?: KnowledgeNodeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeNodes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeNodes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeNodes.
     */
    distinct?: KnowledgeNodeScalarFieldEnum | KnowledgeNodeScalarFieldEnum[]
  }

  /**
   * KnowledgeNode findMany
   */
  export type KnowledgeNodeFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeNodes to fetch.
     */
    where?: KnowledgeNodeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeNodes to fetch.
     */
    orderBy?: KnowledgeNodeOrderByWithRelationInput | KnowledgeNodeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeNodes.
     */
    cursor?: KnowledgeNodeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeNodes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeNodes.
     */
    skip?: number
    distinct?: KnowledgeNodeScalarFieldEnum | KnowledgeNodeScalarFieldEnum[]
  }

  /**
   * KnowledgeNode create
   */
  export type KnowledgeNodeCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeNode.
     */
    data: XOR<KnowledgeNodeCreateInput, KnowledgeNodeUncheckedCreateInput>
  }

  /**
   * KnowledgeNode createMany
   */
  export type KnowledgeNodeCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeNodes.
     */
    data: KnowledgeNodeCreateManyInput | KnowledgeNodeCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeNode createManyAndReturn
   */
  export type KnowledgeNodeCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeNodes.
     */
    data: KnowledgeNodeCreateManyInput | KnowledgeNodeCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeNode update
   */
  export type KnowledgeNodeUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeNode.
     */
    data: XOR<KnowledgeNodeUpdateInput, KnowledgeNodeUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeNode to update.
     */
    where: KnowledgeNodeWhereUniqueInput
  }

  /**
   * KnowledgeNode updateMany
   */
  export type KnowledgeNodeUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeNodes.
     */
    data: XOR<KnowledgeNodeUpdateManyMutationInput, KnowledgeNodeUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeNodes to update
     */
    where?: KnowledgeNodeWhereInput
  }

  /**
   * KnowledgeNode upsert
   */
  export type KnowledgeNodeUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeNode to update in case it exists.
     */
    where: KnowledgeNodeWhereUniqueInput
    /**
     * In case the KnowledgeNode found by the `where` argument doesn't exist, create a new KnowledgeNode with this data.
     */
    create: XOR<KnowledgeNodeCreateInput, KnowledgeNodeUncheckedCreateInput>
    /**
     * In case the KnowledgeNode was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeNodeUpdateInput, KnowledgeNodeUncheckedUpdateInput>
  }

  /**
   * KnowledgeNode delete
   */
  export type KnowledgeNodeDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeNode to delete.
     */
    where: KnowledgeNodeWhereUniqueInput
  }

  /**
   * KnowledgeNode deleteMany
   */
  export type KnowledgeNodeDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeNodes to delete
     */
    where?: KnowledgeNodeWhereInput
  }

  /**
   * KnowledgeNode.outEdges
   */
  export type KnowledgeNode$outEdgesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    where?: KnowledgeEdgeWhereInput
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    cursor?: KnowledgeEdgeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: KnowledgeEdgeScalarFieldEnum | KnowledgeEdgeScalarFieldEnum[]
  }

  /**
   * KnowledgeNode.inEdges
   */
  export type KnowledgeNode$inEdgesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    where?: KnowledgeEdgeWhereInput
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    cursor?: KnowledgeEdgeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: KnowledgeEdgeScalarFieldEnum | KnowledgeEdgeScalarFieldEnum[]
  }

  /**
   * KnowledgeNode without action
   */
  export type KnowledgeNodeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeNode
     */
    select?: KnowledgeNodeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeNodeInclude<ExtArgs> | null
  }


  /**
   * Model KnowledgeEdge
   */

  export type AggregateKnowledgeEdge = {
    _count: KnowledgeEdgeCountAggregateOutputType | null
    _avg: KnowledgeEdgeAvgAggregateOutputType | null
    _sum: KnowledgeEdgeSumAggregateOutputType | null
    _min: KnowledgeEdgeMinAggregateOutputType | null
    _max: KnowledgeEdgeMaxAggregateOutputType | null
  }

  export type KnowledgeEdgeAvgAggregateOutputType = {
    weight: number | null
  }

  export type KnowledgeEdgeSumAggregateOutputType = {
    weight: number | null
  }

  export type KnowledgeEdgeMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    fromId: string | null
    toId: string | null
    relation: string | null
    weight: number | null
    source: string | null
    createdAt: Date | null
  }

  export type KnowledgeEdgeMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    fromId: string | null
    toId: string | null
    relation: string | null
    weight: number | null
    source: string | null
    createdAt: Date | null
  }

  export type KnowledgeEdgeCountAggregateOutputType = {
    id: number
    projectId: number
    fromId: number
    toId: number
    relation: number
    weight: number
    source: number
    createdAt: number
    _all: number
  }


  export type KnowledgeEdgeAvgAggregateInputType = {
    weight?: true
  }

  export type KnowledgeEdgeSumAggregateInputType = {
    weight?: true
  }

  export type KnowledgeEdgeMinAggregateInputType = {
    id?: true
    projectId?: true
    fromId?: true
    toId?: true
    relation?: true
    weight?: true
    source?: true
    createdAt?: true
  }

  export type KnowledgeEdgeMaxAggregateInputType = {
    id?: true
    projectId?: true
    fromId?: true
    toId?: true
    relation?: true
    weight?: true
    source?: true
    createdAt?: true
  }

  export type KnowledgeEdgeCountAggregateInputType = {
    id?: true
    projectId?: true
    fromId?: true
    toId?: true
    relation?: true
    weight?: true
    source?: true
    createdAt?: true
    _all?: true
  }

  export type KnowledgeEdgeAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeEdge to aggregate.
     */
    where?: KnowledgeEdgeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeEdges to fetch.
     */
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: KnowledgeEdgeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeEdges from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeEdges.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned KnowledgeEdges
    **/
    _count?: true | KnowledgeEdgeCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: KnowledgeEdgeAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: KnowledgeEdgeSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: KnowledgeEdgeMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: KnowledgeEdgeMaxAggregateInputType
  }

  export type GetKnowledgeEdgeAggregateType<T extends KnowledgeEdgeAggregateArgs> = {
        [P in keyof T & keyof AggregateKnowledgeEdge]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateKnowledgeEdge[P]>
      : GetScalarType<T[P], AggregateKnowledgeEdge[P]>
  }




  export type KnowledgeEdgeGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: KnowledgeEdgeWhereInput
    orderBy?: KnowledgeEdgeOrderByWithAggregationInput | KnowledgeEdgeOrderByWithAggregationInput[]
    by: KnowledgeEdgeScalarFieldEnum[] | KnowledgeEdgeScalarFieldEnum
    having?: KnowledgeEdgeScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: KnowledgeEdgeCountAggregateInputType | true
    _avg?: KnowledgeEdgeAvgAggregateInputType
    _sum?: KnowledgeEdgeSumAggregateInputType
    _min?: KnowledgeEdgeMinAggregateInputType
    _max?: KnowledgeEdgeMaxAggregateInputType
  }

  export type KnowledgeEdgeGroupByOutputType = {
    id: string
    projectId: string
    fromId: string
    toId: string
    relation: string
    weight: number
    source: string
    createdAt: Date
    _count: KnowledgeEdgeCountAggregateOutputType | null
    _avg: KnowledgeEdgeAvgAggregateOutputType | null
    _sum: KnowledgeEdgeSumAggregateOutputType | null
    _min: KnowledgeEdgeMinAggregateOutputType | null
    _max: KnowledgeEdgeMaxAggregateOutputType | null
  }

  type GetKnowledgeEdgeGroupByPayload<T extends KnowledgeEdgeGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<KnowledgeEdgeGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof KnowledgeEdgeGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], KnowledgeEdgeGroupByOutputType[P]>
            : GetScalarType<T[P], KnowledgeEdgeGroupByOutputType[P]>
        }
      >
    >


  export type KnowledgeEdgeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    fromId?: boolean
    toId?: boolean
    relation?: boolean
    weight?: boolean
    source?: boolean
    createdAt?: boolean
    from?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
    to?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeEdge"]>

  export type KnowledgeEdgeSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    fromId?: boolean
    toId?: boolean
    relation?: boolean
    weight?: boolean
    source?: boolean
    createdAt?: boolean
    from?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
    to?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["knowledgeEdge"]>

  export type KnowledgeEdgeSelectScalar = {
    id?: boolean
    projectId?: boolean
    fromId?: boolean
    toId?: boolean
    relation?: boolean
    weight?: boolean
    source?: boolean
    createdAt?: boolean
  }

  export type KnowledgeEdgeInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    from?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
    to?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
  }
  export type KnowledgeEdgeIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    from?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
    to?: boolean | KnowledgeNodeDefaultArgs<ExtArgs>
  }

  export type $KnowledgeEdgePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "KnowledgeEdge"
    objects: {
      from: Prisma.$KnowledgeNodePayload<ExtArgs>
      to: Prisma.$KnowledgeNodePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      fromId: string
      toId: string
      relation: string
      weight: number
      source: string
      createdAt: Date
    }, ExtArgs["result"]["knowledgeEdge"]>
    composites: {}
  }

  type KnowledgeEdgeGetPayload<S extends boolean | null | undefined | KnowledgeEdgeDefaultArgs> = $Result.GetResult<Prisma.$KnowledgeEdgePayload, S>

  type KnowledgeEdgeCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<KnowledgeEdgeFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: KnowledgeEdgeCountAggregateInputType | true
    }

  export interface KnowledgeEdgeDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['KnowledgeEdge'], meta: { name: 'KnowledgeEdge' } }
    /**
     * Find zero or one KnowledgeEdge that matches the filter.
     * @param {KnowledgeEdgeFindUniqueArgs} args - Arguments to find a KnowledgeEdge
     * @example
     * // Get one KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends KnowledgeEdgeFindUniqueArgs>(args: SelectSubset<T, KnowledgeEdgeFindUniqueArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one KnowledgeEdge that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {KnowledgeEdgeFindUniqueOrThrowArgs} args - Arguments to find a KnowledgeEdge
     * @example
     * // Get one KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends KnowledgeEdgeFindUniqueOrThrowArgs>(args: SelectSubset<T, KnowledgeEdgeFindUniqueOrThrowArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first KnowledgeEdge that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeFindFirstArgs} args - Arguments to find a KnowledgeEdge
     * @example
     * // Get one KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends KnowledgeEdgeFindFirstArgs>(args?: SelectSubset<T, KnowledgeEdgeFindFirstArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first KnowledgeEdge that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeFindFirstOrThrowArgs} args - Arguments to find a KnowledgeEdge
     * @example
     * // Get one KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends KnowledgeEdgeFindFirstOrThrowArgs>(args?: SelectSubset<T, KnowledgeEdgeFindFirstOrThrowArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more KnowledgeEdges that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all KnowledgeEdges
     * const knowledgeEdges = await prisma.knowledgeEdge.findMany()
     * 
     * // Get first 10 KnowledgeEdges
     * const knowledgeEdges = await prisma.knowledgeEdge.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const knowledgeEdgeWithIdOnly = await prisma.knowledgeEdge.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends KnowledgeEdgeFindManyArgs>(args?: SelectSubset<T, KnowledgeEdgeFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a KnowledgeEdge.
     * @param {KnowledgeEdgeCreateArgs} args - Arguments to create a KnowledgeEdge.
     * @example
     * // Create one KnowledgeEdge
     * const KnowledgeEdge = await prisma.knowledgeEdge.create({
     *   data: {
     *     // ... data to create a KnowledgeEdge
     *   }
     * })
     * 
     */
    create<T extends KnowledgeEdgeCreateArgs>(args: SelectSubset<T, KnowledgeEdgeCreateArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many KnowledgeEdges.
     * @param {KnowledgeEdgeCreateManyArgs} args - Arguments to create many KnowledgeEdges.
     * @example
     * // Create many KnowledgeEdges
     * const knowledgeEdge = await prisma.knowledgeEdge.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends KnowledgeEdgeCreateManyArgs>(args?: SelectSubset<T, KnowledgeEdgeCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many KnowledgeEdges and returns the data saved in the database.
     * @param {KnowledgeEdgeCreateManyAndReturnArgs} args - Arguments to create many KnowledgeEdges.
     * @example
     * // Create many KnowledgeEdges
     * const knowledgeEdge = await prisma.knowledgeEdge.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many KnowledgeEdges and only return the `id`
     * const knowledgeEdgeWithIdOnly = await prisma.knowledgeEdge.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends KnowledgeEdgeCreateManyAndReturnArgs>(args?: SelectSubset<T, KnowledgeEdgeCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a KnowledgeEdge.
     * @param {KnowledgeEdgeDeleteArgs} args - Arguments to delete one KnowledgeEdge.
     * @example
     * // Delete one KnowledgeEdge
     * const KnowledgeEdge = await prisma.knowledgeEdge.delete({
     *   where: {
     *     // ... filter to delete one KnowledgeEdge
     *   }
     * })
     * 
     */
    delete<T extends KnowledgeEdgeDeleteArgs>(args: SelectSubset<T, KnowledgeEdgeDeleteArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one KnowledgeEdge.
     * @param {KnowledgeEdgeUpdateArgs} args - Arguments to update one KnowledgeEdge.
     * @example
     * // Update one KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends KnowledgeEdgeUpdateArgs>(args: SelectSubset<T, KnowledgeEdgeUpdateArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more KnowledgeEdges.
     * @param {KnowledgeEdgeDeleteManyArgs} args - Arguments to filter KnowledgeEdges to delete.
     * @example
     * // Delete a few KnowledgeEdges
     * const { count } = await prisma.knowledgeEdge.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends KnowledgeEdgeDeleteManyArgs>(args?: SelectSubset<T, KnowledgeEdgeDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more KnowledgeEdges.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many KnowledgeEdges
     * const knowledgeEdge = await prisma.knowledgeEdge.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends KnowledgeEdgeUpdateManyArgs>(args: SelectSubset<T, KnowledgeEdgeUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one KnowledgeEdge.
     * @param {KnowledgeEdgeUpsertArgs} args - Arguments to update or create a KnowledgeEdge.
     * @example
     * // Update or create a KnowledgeEdge
     * const knowledgeEdge = await prisma.knowledgeEdge.upsert({
     *   create: {
     *     // ... data to create a KnowledgeEdge
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the KnowledgeEdge we want to update
     *   }
     * })
     */
    upsert<T extends KnowledgeEdgeUpsertArgs>(args: SelectSubset<T, KnowledgeEdgeUpsertArgs<ExtArgs>>): Prisma__KnowledgeEdgeClient<$Result.GetResult<Prisma.$KnowledgeEdgePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of KnowledgeEdges.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeCountArgs} args - Arguments to filter KnowledgeEdges to count.
     * @example
     * // Count the number of KnowledgeEdges
     * const count = await prisma.knowledgeEdge.count({
     *   where: {
     *     // ... the filter for the KnowledgeEdges we want to count
     *   }
     * })
    **/
    count<T extends KnowledgeEdgeCountArgs>(
      args?: Subset<T, KnowledgeEdgeCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], KnowledgeEdgeCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a KnowledgeEdge.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends KnowledgeEdgeAggregateArgs>(args: Subset<T, KnowledgeEdgeAggregateArgs>): Prisma.PrismaPromise<GetKnowledgeEdgeAggregateType<T>>

    /**
     * Group by KnowledgeEdge.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {KnowledgeEdgeGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends KnowledgeEdgeGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: KnowledgeEdgeGroupByArgs['orderBy'] }
        : { orderBy?: KnowledgeEdgeGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, KnowledgeEdgeGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetKnowledgeEdgeGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the KnowledgeEdge model
   */
  readonly fields: KnowledgeEdgeFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for KnowledgeEdge.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__KnowledgeEdgeClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    from<T extends KnowledgeNodeDefaultArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeNodeDefaultArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    to<T extends KnowledgeNodeDefaultArgs<ExtArgs> = {}>(args?: Subset<T, KnowledgeNodeDefaultArgs<ExtArgs>>): Prisma__KnowledgeNodeClient<$Result.GetResult<Prisma.$KnowledgeNodePayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the KnowledgeEdge model
   */ 
  interface KnowledgeEdgeFieldRefs {
    readonly id: FieldRef<"KnowledgeEdge", 'String'>
    readonly projectId: FieldRef<"KnowledgeEdge", 'String'>
    readonly fromId: FieldRef<"KnowledgeEdge", 'String'>
    readonly toId: FieldRef<"KnowledgeEdge", 'String'>
    readonly relation: FieldRef<"KnowledgeEdge", 'String'>
    readonly weight: FieldRef<"KnowledgeEdge", 'Float'>
    readonly source: FieldRef<"KnowledgeEdge", 'String'>
    readonly createdAt: FieldRef<"KnowledgeEdge", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * KnowledgeEdge findUnique
   */
  export type KnowledgeEdgeFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeEdge to fetch.
     */
    where: KnowledgeEdgeWhereUniqueInput
  }

  /**
   * KnowledgeEdge findUniqueOrThrow
   */
  export type KnowledgeEdgeFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeEdge to fetch.
     */
    where: KnowledgeEdgeWhereUniqueInput
  }

  /**
   * KnowledgeEdge findFirst
   */
  export type KnowledgeEdgeFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeEdge to fetch.
     */
    where?: KnowledgeEdgeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeEdges to fetch.
     */
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeEdges.
     */
    cursor?: KnowledgeEdgeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeEdges from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeEdges.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeEdges.
     */
    distinct?: KnowledgeEdgeScalarFieldEnum | KnowledgeEdgeScalarFieldEnum[]
  }

  /**
   * KnowledgeEdge findFirstOrThrow
   */
  export type KnowledgeEdgeFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeEdge to fetch.
     */
    where?: KnowledgeEdgeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeEdges to fetch.
     */
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for KnowledgeEdges.
     */
    cursor?: KnowledgeEdgeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeEdges from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeEdges.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of KnowledgeEdges.
     */
    distinct?: KnowledgeEdgeScalarFieldEnum | KnowledgeEdgeScalarFieldEnum[]
  }

  /**
   * KnowledgeEdge findMany
   */
  export type KnowledgeEdgeFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter, which KnowledgeEdges to fetch.
     */
    where?: KnowledgeEdgeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of KnowledgeEdges to fetch.
     */
    orderBy?: KnowledgeEdgeOrderByWithRelationInput | KnowledgeEdgeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing KnowledgeEdges.
     */
    cursor?: KnowledgeEdgeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` KnowledgeEdges from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` KnowledgeEdges.
     */
    skip?: number
    distinct?: KnowledgeEdgeScalarFieldEnum | KnowledgeEdgeScalarFieldEnum[]
  }

  /**
   * KnowledgeEdge create
   */
  export type KnowledgeEdgeCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * The data needed to create a KnowledgeEdge.
     */
    data: XOR<KnowledgeEdgeCreateInput, KnowledgeEdgeUncheckedCreateInput>
  }

  /**
   * KnowledgeEdge createMany
   */
  export type KnowledgeEdgeCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many KnowledgeEdges.
     */
    data: KnowledgeEdgeCreateManyInput | KnowledgeEdgeCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * KnowledgeEdge createManyAndReturn
   */
  export type KnowledgeEdgeCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many KnowledgeEdges.
     */
    data: KnowledgeEdgeCreateManyInput | KnowledgeEdgeCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * KnowledgeEdge update
   */
  export type KnowledgeEdgeUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * The data needed to update a KnowledgeEdge.
     */
    data: XOR<KnowledgeEdgeUpdateInput, KnowledgeEdgeUncheckedUpdateInput>
    /**
     * Choose, which KnowledgeEdge to update.
     */
    where: KnowledgeEdgeWhereUniqueInput
  }

  /**
   * KnowledgeEdge updateMany
   */
  export type KnowledgeEdgeUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update KnowledgeEdges.
     */
    data: XOR<KnowledgeEdgeUpdateManyMutationInput, KnowledgeEdgeUncheckedUpdateManyInput>
    /**
     * Filter which KnowledgeEdges to update
     */
    where?: KnowledgeEdgeWhereInput
  }

  /**
   * KnowledgeEdge upsert
   */
  export type KnowledgeEdgeUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * The filter to search for the KnowledgeEdge to update in case it exists.
     */
    where: KnowledgeEdgeWhereUniqueInput
    /**
     * In case the KnowledgeEdge found by the `where` argument doesn't exist, create a new KnowledgeEdge with this data.
     */
    create: XOR<KnowledgeEdgeCreateInput, KnowledgeEdgeUncheckedCreateInput>
    /**
     * In case the KnowledgeEdge was found with the provided `where` argument, update it with this data.
     */
    update: XOR<KnowledgeEdgeUpdateInput, KnowledgeEdgeUncheckedUpdateInput>
  }

  /**
   * KnowledgeEdge delete
   */
  export type KnowledgeEdgeDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
    /**
     * Filter which KnowledgeEdge to delete.
     */
    where: KnowledgeEdgeWhereUniqueInput
  }

  /**
   * KnowledgeEdge deleteMany
   */
  export type KnowledgeEdgeDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which KnowledgeEdges to delete
     */
    where?: KnowledgeEdgeWhereInput
  }

  /**
   * KnowledgeEdge without action
   */
  export type KnowledgeEdgeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the KnowledgeEdge
     */
    select?: KnowledgeEdgeSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: KnowledgeEdgeInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const MissionScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    title: 'title',
    objective: 'objective',
    status: 'status',
    context: 'context',
    createdAt: 'createdAt',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    updatedAt: 'updatedAt'
  };

  export type MissionScalarFieldEnum = (typeof MissionScalarFieldEnum)[keyof typeof MissionScalarFieldEnum]


  export const MissionStepScalarFieldEnum: {
    id: 'id',
    missionId: 'missionId',
    title: 'title',
    status: 'status',
    skillId: 'skillId',
    prompt: 'prompt',
    input: 'input',
    output: 'output',
    dependsOn: 'dependsOn',
    retries: 'retries',
    executor: 'executor',
    approvalGateId: 'approvalGateId',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type MissionStepScalarFieldEnum = (typeof MissionStepScalarFieldEnum)[keyof typeof MissionStepScalarFieldEnum]


  export const MemoryMetaScalarFieldEnum: {
    id: 'id',
    v1DocumentId: 'v1DocumentId',
    projectId: 'projectId',
    memoryClass: 'memoryClass',
    accessCount: 'accessCount',
    lastAccessAt: 'lastAccessAt',
    consolidatedInto: 'consolidatedInto',
    memoryType: 'memoryType',
    confidence: 'confidence',
    validUntil: 'validUntil',
    missionId: 'missionId',
    notes: 'notes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type MemoryMetaScalarFieldEnum = (typeof MemoryMetaScalarFieldEnum)[keyof typeof MemoryMetaScalarFieldEnum]


  export const VaultAccessLogScalarFieldEnum: {
    id: 'id',
    projectSlug: 'projectSlug',
    key: 'key',
    accessor: 'accessor',
    missionId: 'missionId',
    stepId: 'stepId',
    accessedAt: 'accessedAt'
  };

  export type VaultAccessLogScalarFieldEnum = (typeof VaultAccessLogScalarFieldEnum)[keyof typeof VaultAccessLogScalarFieldEnum]


  export const KnowledgeNodeScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    type: 'type',
    label: 'label',
    description: 'description',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type KnowledgeNodeScalarFieldEnum = (typeof KnowledgeNodeScalarFieldEnum)[keyof typeof KnowledgeNodeScalarFieldEnum]


  export const KnowledgeEdgeScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    fromId: 'fromId',
    toId: 'toId',
    relation: 'relation',
    weight: 'weight',
    source: 'source',
    createdAt: 'createdAt'
  };

  export type KnowledgeEdgeScalarFieldEnum = (typeof KnowledgeEdgeScalarFieldEnum)[keyof typeof KnowledgeEdgeScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type MissionWhereInput = {
    AND?: MissionWhereInput | MissionWhereInput[]
    OR?: MissionWhereInput[]
    NOT?: MissionWhereInput | MissionWhereInput[]
    id?: StringFilter<"Mission"> | string
    projectId?: StringFilter<"Mission"> | string
    title?: StringFilter<"Mission"> | string
    objective?: StringFilter<"Mission"> | string
    status?: StringFilter<"Mission"> | string
    context?: JsonFilter<"Mission">
    createdAt?: DateTimeFilter<"Mission"> | Date | string
    startedAt?: DateTimeNullableFilter<"Mission"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"Mission"> | Date | string | null
    updatedAt?: DateTimeFilter<"Mission"> | Date | string
    steps?: MissionStepListRelationFilter
  }

  export type MissionOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    objective?: SortOrder
    status?: SortOrder
    context?: SortOrder
    createdAt?: SortOrder
    startedAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    updatedAt?: SortOrder
    steps?: MissionStepOrderByRelationAggregateInput
  }

  export type MissionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: MissionWhereInput | MissionWhereInput[]
    OR?: MissionWhereInput[]
    NOT?: MissionWhereInput | MissionWhereInput[]
    projectId?: StringFilter<"Mission"> | string
    title?: StringFilter<"Mission"> | string
    objective?: StringFilter<"Mission"> | string
    status?: StringFilter<"Mission"> | string
    context?: JsonFilter<"Mission">
    createdAt?: DateTimeFilter<"Mission"> | Date | string
    startedAt?: DateTimeNullableFilter<"Mission"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"Mission"> | Date | string | null
    updatedAt?: DateTimeFilter<"Mission"> | Date | string
    steps?: MissionStepListRelationFilter
  }, "id">

  export type MissionOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    objective?: SortOrder
    status?: SortOrder
    context?: SortOrder
    createdAt?: SortOrder
    startedAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    updatedAt?: SortOrder
    _count?: MissionCountOrderByAggregateInput
    _max?: MissionMaxOrderByAggregateInput
    _min?: MissionMinOrderByAggregateInput
  }

  export type MissionScalarWhereWithAggregatesInput = {
    AND?: MissionScalarWhereWithAggregatesInput | MissionScalarWhereWithAggregatesInput[]
    OR?: MissionScalarWhereWithAggregatesInput[]
    NOT?: MissionScalarWhereWithAggregatesInput | MissionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Mission"> | string
    projectId?: StringWithAggregatesFilter<"Mission"> | string
    title?: StringWithAggregatesFilter<"Mission"> | string
    objective?: StringWithAggregatesFilter<"Mission"> | string
    status?: StringWithAggregatesFilter<"Mission"> | string
    context?: JsonWithAggregatesFilter<"Mission">
    createdAt?: DateTimeWithAggregatesFilter<"Mission"> | Date | string
    startedAt?: DateTimeNullableWithAggregatesFilter<"Mission"> | Date | string | null
    completedAt?: DateTimeNullableWithAggregatesFilter<"Mission"> | Date | string | null
    updatedAt?: DateTimeWithAggregatesFilter<"Mission"> | Date | string
  }

  export type MissionStepWhereInput = {
    AND?: MissionStepWhereInput | MissionStepWhereInput[]
    OR?: MissionStepWhereInput[]
    NOT?: MissionStepWhereInput | MissionStepWhereInput[]
    id?: StringFilter<"MissionStep"> | string
    missionId?: StringFilter<"MissionStep"> | string
    title?: StringFilter<"MissionStep"> | string
    status?: StringFilter<"MissionStep"> | string
    skillId?: StringNullableFilter<"MissionStep"> | string | null
    prompt?: StringNullableFilter<"MissionStep"> | string | null
    input?: JsonFilter<"MissionStep">
    output?: JsonNullableFilter<"MissionStep">
    dependsOn?: StringNullableListFilter<"MissionStep">
    retries?: IntFilter<"MissionStep"> | number
    executor?: StringFilter<"MissionStep"> | string
    approvalGateId?: StringNullableFilter<"MissionStep"> | string | null
    startedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    createdAt?: DateTimeFilter<"MissionStep"> | Date | string
    updatedAt?: DateTimeFilter<"MissionStep"> | Date | string
    mission?: XOR<MissionRelationFilter, MissionWhereInput>
  }

  export type MissionStepOrderByWithRelationInput = {
    id?: SortOrder
    missionId?: SortOrder
    title?: SortOrder
    status?: SortOrder
    skillId?: SortOrderInput | SortOrder
    prompt?: SortOrderInput | SortOrder
    input?: SortOrder
    output?: SortOrderInput | SortOrder
    dependsOn?: SortOrder
    retries?: SortOrder
    executor?: SortOrder
    approvalGateId?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    mission?: MissionOrderByWithRelationInput
  }

  export type MissionStepWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: MissionStepWhereInput | MissionStepWhereInput[]
    OR?: MissionStepWhereInput[]
    NOT?: MissionStepWhereInput | MissionStepWhereInput[]
    missionId?: StringFilter<"MissionStep"> | string
    title?: StringFilter<"MissionStep"> | string
    status?: StringFilter<"MissionStep"> | string
    skillId?: StringNullableFilter<"MissionStep"> | string | null
    prompt?: StringNullableFilter<"MissionStep"> | string | null
    input?: JsonFilter<"MissionStep">
    output?: JsonNullableFilter<"MissionStep">
    dependsOn?: StringNullableListFilter<"MissionStep">
    retries?: IntFilter<"MissionStep"> | number
    executor?: StringFilter<"MissionStep"> | string
    approvalGateId?: StringNullableFilter<"MissionStep"> | string | null
    startedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    createdAt?: DateTimeFilter<"MissionStep"> | Date | string
    updatedAt?: DateTimeFilter<"MissionStep"> | Date | string
    mission?: XOR<MissionRelationFilter, MissionWhereInput>
  }, "id">

  export type MissionStepOrderByWithAggregationInput = {
    id?: SortOrder
    missionId?: SortOrder
    title?: SortOrder
    status?: SortOrder
    skillId?: SortOrderInput | SortOrder
    prompt?: SortOrderInput | SortOrder
    input?: SortOrder
    output?: SortOrderInput | SortOrder
    dependsOn?: SortOrder
    retries?: SortOrder
    executor?: SortOrder
    approvalGateId?: SortOrderInput | SortOrder
    startedAt?: SortOrderInput | SortOrder
    completedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: MissionStepCountOrderByAggregateInput
    _avg?: MissionStepAvgOrderByAggregateInput
    _max?: MissionStepMaxOrderByAggregateInput
    _min?: MissionStepMinOrderByAggregateInput
    _sum?: MissionStepSumOrderByAggregateInput
  }

  export type MissionStepScalarWhereWithAggregatesInput = {
    AND?: MissionStepScalarWhereWithAggregatesInput | MissionStepScalarWhereWithAggregatesInput[]
    OR?: MissionStepScalarWhereWithAggregatesInput[]
    NOT?: MissionStepScalarWhereWithAggregatesInput | MissionStepScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"MissionStep"> | string
    missionId?: StringWithAggregatesFilter<"MissionStep"> | string
    title?: StringWithAggregatesFilter<"MissionStep"> | string
    status?: StringWithAggregatesFilter<"MissionStep"> | string
    skillId?: StringNullableWithAggregatesFilter<"MissionStep"> | string | null
    prompt?: StringNullableWithAggregatesFilter<"MissionStep"> | string | null
    input?: JsonWithAggregatesFilter<"MissionStep">
    output?: JsonNullableWithAggregatesFilter<"MissionStep">
    dependsOn?: StringNullableListFilter<"MissionStep">
    retries?: IntWithAggregatesFilter<"MissionStep"> | number
    executor?: StringWithAggregatesFilter<"MissionStep"> | string
    approvalGateId?: StringNullableWithAggregatesFilter<"MissionStep"> | string | null
    startedAt?: DateTimeNullableWithAggregatesFilter<"MissionStep"> | Date | string | null
    completedAt?: DateTimeNullableWithAggregatesFilter<"MissionStep"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"MissionStep"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"MissionStep"> | Date | string
  }

  export type MemoryMetaWhereInput = {
    AND?: MemoryMetaWhereInput | MemoryMetaWhereInput[]
    OR?: MemoryMetaWhereInput[]
    NOT?: MemoryMetaWhereInput | MemoryMetaWhereInput[]
    id?: StringFilter<"MemoryMeta"> | string
    v1DocumentId?: StringFilter<"MemoryMeta"> | string
    projectId?: StringFilter<"MemoryMeta"> | string
    memoryClass?: StringFilter<"MemoryMeta"> | string
    accessCount?: IntFilter<"MemoryMeta"> | number
    lastAccessAt?: DateTimeNullableFilter<"MemoryMeta"> | Date | string | null
    consolidatedInto?: StringNullableFilter<"MemoryMeta"> | string | null
    memoryType?: StringNullableFilter<"MemoryMeta"> | string | null
    confidence?: FloatNullableFilter<"MemoryMeta"> | number | null
    validUntil?: DateTimeNullableFilter<"MemoryMeta"> | Date | string | null
    missionId?: StringNullableFilter<"MemoryMeta"> | string | null
    notes?: StringNullableFilter<"MemoryMeta"> | string | null
    createdAt?: DateTimeFilter<"MemoryMeta"> | Date | string
    updatedAt?: DateTimeFilter<"MemoryMeta"> | Date | string
  }

  export type MemoryMetaOrderByWithRelationInput = {
    id?: SortOrder
    v1DocumentId?: SortOrder
    projectId?: SortOrder
    memoryClass?: SortOrder
    accessCount?: SortOrder
    lastAccessAt?: SortOrderInput | SortOrder
    consolidatedInto?: SortOrderInput | SortOrder
    memoryType?: SortOrderInput | SortOrder
    confidence?: SortOrderInput | SortOrder
    validUntil?: SortOrderInput | SortOrder
    missionId?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MemoryMetaWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    v1DocumentId?: string
    AND?: MemoryMetaWhereInput | MemoryMetaWhereInput[]
    OR?: MemoryMetaWhereInput[]
    NOT?: MemoryMetaWhereInput | MemoryMetaWhereInput[]
    projectId?: StringFilter<"MemoryMeta"> | string
    memoryClass?: StringFilter<"MemoryMeta"> | string
    accessCount?: IntFilter<"MemoryMeta"> | number
    lastAccessAt?: DateTimeNullableFilter<"MemoryMeta"> | Date | string | null
    consolidatedInto?: StringNullableFilter<"MemoryMeta"> | string | null
    memoryType?: StringNullableFilter<"MemoryMeta"> | string | null
    confidence?: FloatNullableFilter<"MemoryMeta"> | number | null
    validUntil?: DateTimeNullableFilter<"MemoryMeta"> | Date | string | null
    missionId?: StringNullableFilter<"MemoryMeta"> | string | null
    notes?: StringNullableFilter<"MemoryMeta"> | string | null
    createdAt?: DateTimeFilter<"MemoryMeta"> | Date | string
    updatedAt?: DateTimeFilter<"MemoryMeta"> | Date | string
  }, "id" | "v1DocumentId">

  export type MemoryMetaOrderByWithAggregationInput = {
    id?: SortOrder
    v1DocumentId?: SortOrder
    projectId?: SortOrder
    memoryClass?: SortOrder
    accessCount?: SortOrder
    lastAccessAt?: SortOrderInput | SortOrder
    consolidatedInto?: SortOrderInput | SortOrder
    memoryType?: SortOrderInput | SortOrder
    confidence?: SortOrderInput | SortOrder
    validUntil?: SortOrderInput | SortOrder
    missionId?: SortOrderInput | SortOrder
    notes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: MemoryMetaCountOrderByAggregateInput
    _avg?: MemoryMetaAvgOrderByAggregateInput
    _max?: MemoryMetaMaxOrderByAggregateInput
    _min?: MemoryMetaMinOrderByAggregateInput
    _sum?: MemoryMetaSumOrderByAggregateInput
  }

  export type MemoryMetaScalarWhereWithAggregatesInput = {
    AND?: MemoryMetaScalarWhereWithAggregatesInput | MemoryMetaScalarWhereWithAggregatesInput[]
    OR?: MemoryMetaScalarWhereWithAggregatesInput[]
    NOT?: MemoryMetaScalarWhereWithAggregatesInput | MemoryMetaScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"MemoryMeta"> | string
    v1DocumentId?: StringWithAggregatesFilter<"MemoryMeta"> | string
    projectId?: StringWithAggregatesFilter<"MemoryMeta"> | string
    memoryClass?: StringWithAggregatesFilter<"MemoryMeta"> | string
    accessCount?: IntWithAggregatesFilter<"MemoryMeta"> | number
    lastAccessAt?: DateTimeNullableWithAggregatesFilter<"MemoryMeta"> | Date | string | null
    consolidatedInto?: StringNullableWithAggregatesFilter<"MemoryMeta"> | string | null
    memoryType?: StringNullableWithAggregatesFilter<"MemoryMeta"> | string | null
    confidence?: FloatNullableWithAggregatesFilter<"MemoryMeta"> | number | null
    validUntil?: DateTimeNullableWithAggregatesFilter<"MemoryMeta"> | Date | string | null
    missionId?: StringNullableWithAggregatesFilter<"MemoryMeta"> | string | null
    notes?: StringNullableWithAggregatesFilter<"MemoryMeta"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"MemoryMeta"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"MemoryMeta"> | Date | string
  }

  export type VaultAccessLogWhereInput = {
    AND?: VaultAccessLogWhereInput | VaultAccessLogWhereInput[]
    OR?: VaultAccessLogWhereInput[]
    NOT?: VaultAccessLogWhereInput | VaultAccessLogWhereInput[]
    id?: StringFilter<"VaultAccessLog"> | string
    projectSlug?: StringFilter<"VaultAccessLog"> | string
    key?: StringFilter<"VaultAccessLog"> | string
    accessor?: StringFilter<"VaultAccessLog"> | string
    missionId?: StringNullableFilter<"VaultAccessLog"> | string | null
    stepId?: StringNullableFilter<"VaultAccessLog"> | string | null
    accessedAt?: DateTimeFilter<"VaultAccessLog"> | Date | string
  }

  export type VaultAccessLogOrderByWithRelationInput = {
    id?: SortOrder
    projectSlug?: SortOrder
    key?: SortOrder
    accessor?: SortOrder
    missionId?: SortOrderInput | SortOrder
    stepId?: SortOrderInput | SortOrder
    accessedAt?: SortOrder
  }

  export type VaultAccessLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: VaultAccessLogWhereInput | VaultAccessLogWhereInput[]
    OR?: VaultAccessLogWhereInput[]
    NOT?: VaultAccessLogWhereInput | VaultAccessLogWhereInput[]
    projectSlug?: StringFilter<"VaultAccessLog"> | string
    key?: StringFilter<"VaultAccessLog"> | string
    accessor?: StringFilter<"VaultAccessLog"> | string
    missionId?: StringNullableFilter<"VaultAccessLog"> | string | null
    stepId?: StringNullableFilter<"VaultAccessLog"> | string | null
    accessedAt?: DateTimeFilter<"VaultAccessLog"> | Date | string
  }, "id">

  export type VaultAccessLogOrderByWithAggregationInput = {
    id?: SortOrder
    projectSlug?: SortOrder
    key?: SortOrder
    accessor?: SortOrder
    missionId?: SortOrderInput | SortOrder
    stepId?: SortOrderInput | SortOrder
    accessedAt?: SortOrder
    _count?: VaultAccessLogCountOrderByAggregateInput
    _max?: VaultAccessLogMaxOrderByAggregateInput
    _min?: VaultAccessLogMinOrderByAggregateInput
  }

  export type VaultAccessLogScalarWhereWithAggregatesInput = {
    AND?: VaultAccessLogScalarWhereWithAggregatesInput | VaultAccessLogScalarWhereWithAggregatesInput[]
    OR?: VaultAccessLogScalarWhereWithAggregatesInput[]
    NOT?: VaultAccessLogScalarWhereWithAggregatesInput | VaultAccessLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"VaultAccessLog"> | string
    projectSlug?: StringWithAggregatesFilter<"VaultAccessLog"> | string
    key?: StringWithAggregatesFilter<"VaultAccessLog"> | string
    accessor?: StringWithAggregatesFilter<"VaultAccessLog"> | string
    missionId?: StringNullableWithAggregatesFilter<"VaultAccessLog"> | string | null
    stepId?: StringNullableWithAggregatesFilter<"VaultAccessLog"> | string | null
    accessedAt?: DateTimeWithAggregatesFilter<"VaultAccessLog"> | Date | string
  }

  export type KnowledgeNodeWhereInput = {
    AND?: KnowledgeNodeWhereInput | KnowledgeNodeWhereInput[]
    OR?: KnowledgeNodeWhereInput[]
    NOT?: KnowledgeNodeWhereInput | KnowledgeNodeWhereInput[]
    id?: StringFilter<"KnowledgeNode"> | string
    projectId?: StringFilter<"KnowledgeNode"> | string
    type?: StringFilter<"KnowledgeNode"> | string
    label?: StringFilter<"KnowledgeNode"> | string
    description?: StringNullableFilter<"KnowledgeNode"> | string | null
    metadata?: JsonFilter<"KnowledgeNode">
    createdAt?: DateTimeFilter<"KnowledgeNode"> | Date | string
    updatedAt?: DateTimeFilter<"KnowledgeNode"> | Date | string
    outEdges?: KnowledgeEdgeListRelationFilter
    inEdges?: KnowledgeEdgeListRelationFilter
  }

  export type KnowledgeNodeOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    type?: SortOrder
    label?: SortOrder
    description?: SortOrderInput | SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    outEdges?: KnowledgeEdgeOrderByRelationAggregateInput
    inEdges?: KnowledgeEdgeOrderByRelationAggregateInput
  }

  export type KnowledgeNodeWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: KnowledgeNodeWhereInput | KnowledgeNodeWhereInput[]
    OR?: KnowledgeNodeWhereInput[]
    NOT?: KnowledgeNodeWhereInput | KnowledgeNodeWhereInput[]
    projectId?: StringFilter<"KnowledgeNode"> | string
    type?: StringFilter<"KnowledgeNode"> | string
    label?: StringFilter<"KnowledgeNode"> | string
    description?: StringNullableFilter<"KnowledgeNode"> | string | null
    metadata?: JsonFilter<"KnowledgeNode">
    createdAt?: DateTimeFilter<"KnowledgeNode"> | Date | string
    updatedAt?: DateTimeFilter<"KnowledgeNode"> | Date | string
    outEdges?: KnowledgeEdgeListRelationFilter
    inEdges?: KnowledgeEdgeListRelationFilter
  }, "id">

  export type KnowledgeNodeOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    type?: SortOrder
    label?: SortOrder
    description?: SortOrderInput | SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: KnowledgeNodeCountOrderByAggregateInput
    _max?: KnowledgeNodeMaxOrderByAggregateInput
    _min?: KnowledgeNodeMinOrderByAggregateInput
  }

  export type KnowledgeNodeScalarWhereWithAggregatesInput = {
    AND?: KnowledgeNodeScalarWhereWithAggregatesInput | KnowledgeNodeScalarWhereWithAggregatesInput[]
    OR?: KnowledgeNodeScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeNodeScalarWhereWithAggregatesInput | KnowledgeNodeScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeNode"> | string
    projectId?: StringWithAggregatesFilter<"KnowledgeNode"> | string
    type?: StringWithAggregatesFilter<"KnowledgeNode"> | string
    label?: StringWithAggregatesFilter<"KnowledgeNode"> | string
    description?: StringNullableWithAggregatesFilter<"KnowledgeNode"> | string | null
    metadata?: JsonWithAggregatesFilter<"KnowledgeNode">
    createdAt?: DateTimeWithAggregatesFilter<"KnowledgeNode"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"KnowledgeNode"> | Date | string
  }

  export type KnowledgeEdgeWhereInput = {
    AND?: KnowledgeEdgeWhereInput | KnowledgeEdgeWhereInput[]
    OR?: KnowledgeEdgeWhereInput[]
    NOT?: KnowledgeEdgeWhereInput | KnowledgeEdgeWhereInput[]
    id?: StringFilter<"KnowledgeEdge"> | string
    projectId?: StringFilter<"KnowledgeEdge"> | string
    fromId?: StringFilter<"KnowledgeEdge"> | string
    toId?: StringFilter<"KnowledgeEdge"> | string
    relation?: StringFilter<"KnowledgeEdge"> | string
    weight?: FloatFilter<"KnowledgeEdge"> | number
    source?: StringFilter<"KnowledgeEdge"> | string
    createdAt?: DateTimeFilter<"KnowledgeEdge"> | Date | string
    from?: XOR<KnowledgeNodeRelationFilter, KnowledgeNodeWhereInput>
    to?: XOR<KnowledgeNodeRelationFilter, KnowledgeNodeWhereInput>
  }

  export type KnowledgeEdgeOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    fromId?: SortOrder
    toId?: SortOrder
    relation?: SortOrder
    weight?: SortOrder
    source?: SortOrder
    createdAt?: SortOrder
    from?: KnowledgeNodeOrderByWithRelationInput
    to?: KnowledgeNodeOrderByWithRelationInput
  }

  export type KnowledgeEdgeWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: KnowledgeEdgeWhereInput | KnowledgeEdgeWhereInput[]
    OR?: KnowledgeEdgeWhereInput[]
    NOT?: KnowledgeEdgeWhereInput | KnowledgeEdgeWhereInput[]
    projectId?: StringFilter<"KnowledgeEdge"> | string
    fromId?: StringFilter<"KnowledgeEdge"> | string
    toId?: StringFilter<"KnowledgeEdge"> | string
    relation?: StringFilter<"KnowledgeEdge"> | string
    weight?: FloatFilter<"KnowledgeEdge"> | number
    source?: StringFilter<"KnowledgeEdge"> | string
    createdAt?: DateTimeFilter<"KnowledgeEdge"> | Date | string
    from?: XOR<KnowledgeNodeRelationFilter, KnowledgeNodeWhereInput>
    to?: XOR<KnowledgeNodeRelationFilter, KnowledgeNodeWhereInput>
  }, "id">

  export type KnowledgeEdgeOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    fromId?: SortOrder
    toId?: SortOrder
    relation?: SortOrder
    weight?: SortOrder
    source?: SortOrder
    createdAt?: SortOrder
    _count?: KnowledgeEdgeCountOrderByAggregateInput
    _avg?: KnowledgeEdgeAvgOrderByAggregateInput
    _max?: KnowledgeEdgeMaxOrderByAggregateInput
    _min?: KnowledgeEdgeMinOrderByAggregateInput
    _sum?: KnowledgeEdgeSumOrderByAggregateInput
  }

  export type KnowledgeEdgeScalarWhereWithAggregatesInput = {
    AND?: KnowledgeEdgeScalarWhereWithAggregatesInput | KnowledgeEdgeScalarWhereWithAggregatesInput[]
    OR?: KnowledgeEdgeScalarWhereWithAggregatesInput[]
    NOT?: KnowledgeEdgeScalarWhereWithAggregatesInput | KnowledgeEdgeScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    projectId?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    fromId?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    toId?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    relation?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    weight?: FloatWithAggregatesFilter<"KnowledgeEdge"> | number
    source?: StringWithAggregatesFilter<"KnowledgeEdge"> | string
    createdAt?: DateTimeWithAggregatesFilter<"KnowledgeEdge"> | Date | string
  }

  export type MissionCreateInput = {
    id?: string
    projectId: string
    title: string
    objective: string
    status?: string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    updatedAt?: Date | string
    steps?: MissionStepCreateNestedManyWithoutMissionInput
  }

  export type MissionUncheckedCreateInput = {
    id?: string
    projectId: string
    title: string
    objective: string
    status?: string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    updatedAt?: Date | string
    steps?: MissionStepUncheckedCreateNestedManyWithoutMissionInput
  }

  export type MissionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: MissionStepUpdateManyWithoutMissionNestedInput
  }

  export type MissionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: MissionStepUncheckedUpdateManyWithoutMissionNestedInput
  }

  export type MissionCreateManyInput = {
    id?: string
    projectId: string
    title: string
    objective: string
    status?: string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    updatedAt?: Date | string
  }

  export type MissionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionStepCreateInput = {
    id?: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    mission: MissionCreateNestedOneWithoutStepsInput
  }

  export type MissionStepUncheckedCreateInput = {
    id?: string
    missionId: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MissionStepUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    mission?: MissionUpdateOneRequiredWithoutStepsNestedInput
  }

  export type MissionStepUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    missionId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionStepCreateManyInput = {
    id?: string
    missionId: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MissionStepUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionStepUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    missionId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MemoryMetaCreateInput = {
    id?: string
    v1DocumentId: string
    projectId: string
    memoryClass?: string
    accessCount?: number
    lastAccessAt?: Date | string | null
    consolidatedInto?: string | null
    memoryType?: string | null
    confidence?: number | null
    validUntil?: Date | string | null
    missionId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MemoryMetaUncheckedCreateInput = {
    id?: string
    v1DocumentId: string
    projectId: string
    memoryClass?: string
    accessCount?: number
    lastAccessAt?: Date | string | null
    consolidatedInto?: string | null
    memoryType?: string | null
    confidence?: number | null
    validUntil?: Date | string | null
    missionId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MemoryMetaUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    v1DocumentId?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    memoryClass?: StringFieldUpdateOperationsInput | string
    accessCount?: IntFieldUpdateOperationsInput | number
    lastAccessAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    consolidatedInto?: NullableStringFieldUpdateOperationsInput | string | null
    memoryType?: NullableStringFieldUpdateOperationsInput | string | null
    confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    validUntil?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MemoryMetaUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    v1DocumentId?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    memoryClass?: StringFieldUpdateOperationsInput | string
    accessCount?: IntFieldUpdateOperationsInput | number
    lastAccessAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    consolidatedInto?: NullableStringFieldUpdateOperationsInput | string | null
    memoryType?: NullableStringFieldUpdateOperationsInput | string | null
    confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    validUntil?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MemoryMetaCreateManyInput = {
    id?: string
    v1DocumentId: string
    projectId: string
    memoryClass?: string
    accessCount?: number
    lastAccessAt?: Date | string | null
    consolidatedInto?: string | null
    memoryType?: string | null
    confidence?: number | null
    validUntil?: Date | string | null
    missionId?: string | null
    notes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MemoryMetaUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    v1DocumentId?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    memoryClass?: StringFieldUpdateOperationsInput | string
    accessCount?: IntFieldUpdateOperationsInput | number
    lastAccessAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    consolidatedInto?: NullableStringFieldUpdateOperationsInput | string | null
    memoryType?: NullableStringFieldUpdateOperationsInput | string | null
    confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    validUntil?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MemoryMetaUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    v1DocumentId?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    memoryClass?: StringFieldUpdateOperationsInput | string
    accessCount?: IntFieldUpdateOperationsInput | number
    lastAccessAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    consolidatedInto?: NullableStringFieldUpdateOperationsInput | string | null
    memoryType?: NullableStringFieldUpdateOperationsInput | string | null
    confidence?: NullableFloatFieldUpdateOperationsInput | number | null
    validUntil?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type VaultAccessLogCreateInput = {
    id?: string
    projectSlug: string
    key: string
    accessor?: string
    missionId?: string | null
    stepId?: string | null
    accessedAt?: Date | string
  }

  export type VaultAccessLogUncheckedCreateInput = {
    id?: string
    projectSlug: string
    key: string
    accessor?: string
    missionId?: string | null
    stepId?: string | null
    accessedAt?: Date | string
  }

  export type VaultAccessLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectSlug?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    accessor?: StringFieldUpdateOperationsInput | string
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    accessedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type VaultAccessLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectSlug?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    accessor?: StringFieldUpdateOperationsInput | string
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    accessedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type VaultAccessLogCreateManyInput = {
    id?: string
    projectSlug: string
    key: string
    accessor?: string
    missionId?: string | null
    stepId?: string | null
    accessedAt?: Date | string
  }

  export type VaultAccessLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectSlug?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    accessor?: StringFieldUpdateOperationsInput | string
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    accessedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type VaultAccessLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectSlug?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    accessor?: StringFieldUpdateOperationsInput | string
    missionId?: NullableStringFieldUpdateOperationsInput | string | null
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    accessedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeNodeCreateInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    outEdges?: KnowledgeEdgeCreateNestedManyWithoutFromInput
    inEdges?: KnowledgeEdgeCreateNestedManyWithoutToInput
  }

  export type KnowledgeNodeUncheckedCreateInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    outEdges?: KnowledgeEdgeUncheckedCreateNestedManyWithoutFromInput
    inEdges?: KnowledgeEdgeUncheckedCreateNestedManyWithoutToInput
  }

  export type KnowledgeNodeUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    outEdges?: KnowledgeEdgeUpdateManyWithoutFromNestedInput
    inEdges?: KnowledgeEdgeUpdateManyWithoutToNestedInput
  }

  export type KnowledgeNodeUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    outEdges?: KnowledgeEdgeUncheckedUpdateManyWithoutFromNestedInput
    inEdges?: KnowledgeEdgeUncheckedUpdateManyWithoutToNestedInput
  }

  export type KnowledgeNodeCreateManyInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type KnowledgeNodeUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeNodeUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeCreateInput = {
    id?: string
    projectId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
    from: KnowledgeNodeCreateNestedOneWithoutOutEdgesInput
    to: KnowledgeNodeCreateNestedOneWithoutInEdgesInput
  }

  export type KnowledgeEdgeUncheckedCreateInput = {
    id?: string
    projectId: string
    fromId: string
    toId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    from?: KnowledgeNodeUpdateOneRequiredWithoutOutEdgesNestedInput
    to?: KnowledgeNodeUpdateOneRequiredWithoutInEdgesNestedInput
  }

  export type KnowledgeEdgeUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    fromId?: StringFieldUpdateOperationsInput | string
    toId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeCreateManyInput = {
    id?: string
    projectId: string
    fromId: string
    toId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    fromId?: StringFieldUpdateOperationsInput | string
    toId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }
  export type JsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type MissionStepListRelationFilter = {
    every?: MissionStepWhereInput
    some?: MissionStepWhereInput
    none?: MissionStepWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type MissionStepOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MissionCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    objective?: SortOrder
    status?: SortOrder
    context?: SortOrder
    createdAt?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MissionMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    objective?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MissionMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    objective?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }
  export type JsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type MissionRelationFilter = {
    is?: MissionWhereInput
    isNot?: MissionWhereInput
  }

  export type MissionStepCountOrderByAggregateInput = {
    id?: SortOrder
    missionId?: SortOrder
    title?: SortOrder
    status?: SortOrder
    skillId?: SortOrder
    prompt?: SortOrder
    input?: SortOrder
    output?: SortOrder
    dependsOn?: SortOrder
    retries?: SortOrder
    executor?: SortOrder
    approvalGateId?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MissionStepAvgOrderByAggregateInput = {
    retries?: SortOrder
  }

  export type MissionStepMaxOrderByAggregateInput = {
    id?: SortOrder
    missionId?: SortOrder
    title?: SortOrder
    status?: SortOrder
    skillId?: SortOrder
    prompt?: SortOrder
    retries?: SortOrder
    executor?: SortOrder
    approvalGateId?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MissionStepMinOrderByAggregateInput = {
    id?: SortOrder
    missionId?: SortOrder
    title?: SortOrder
    status?: SortOrder
    skillId?: SortOrder
    prompt?: SortOrder
    retries?: SortOrder
    executor?: SortOrder
    approvalGateId?: SortOrder
    startedAt?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MissionStepSumOrderByAggregateInput = {
    retries?: SortOrder
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type MemoryMetaCountOrderByAggregateInput = {
    id?: SortOrder
    v1DocumentId?: SortOrder
    projectId?: SortOrder
    memoryClass?: SortOrder
    accessCount?: SortOrder
    lastAccessAt?: SortOrder
    consolidatedInto?: SortOrder
    memoryType?: SortOrder
    confidence?: SortOrder
    validUntil?: SortOrder
    missionId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MemoryMetaAvgOrderByAggregateInput = {
    accessCount?: SortOrder
    confidence?: SortOrder
  }

  export type MemoryMetaMaxOrderByAggregateInput = {
    id?: SortOrder
    v1DocumentId?: SortOrder
    projectId?: SortOrder
    memoryClass?: SortOrder
    accessCount?: SortOrder
    lastAccessAt?: SortOrder
    consolidatedInto?: SortOrder
    memoryType?: SortOrder
    confidence?: SortOrder
    validUntil?: SortOrder
    missionId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MemoryMetaMinOrderByAggregateInput = {
    id?: SortOrder
    v1DocumentId?: SortOrder
    projectId?: SortOrder
    memoryClass?: SortOrder
    accessCount?: SortOrder
    lastAccessAt?: SortOrder
    consolidatedInto?: SortOrder
    memoryType?: SortOrder
    confidence?: SortOrder
    validUntil?: SortOrder
    missionId?: SortOrder
    notes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MemoryMetaSumOrderByAggregateInput = {
    accessCount?: SortOrder
    confidence?: SortOrder
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type VaultAccessLogCountOrderByAggregateInput = {
    id?: SortOrder
    projectSlug?: SortOrder
    key?: SortOrder
    accessor?: SortOrder
    missionId?: SortOrder
    stepId?: SortOrder
    accessedAt?: SortOrder
  }

  export type VaultAccessLogMaxOrderByAggregateInput = {
    id?: SortOrder
    projectSlug?: SortOrder
    key?: SortOrder
    accessor?: SortOrder
    missionId?: SortOrder
    stepId?: SortOrder
    accessedAt?: SortOrder
  }

  export type VaultAccessLogMinOrderByAggregateInput = {
    id?: SortOrder
    projectSlug?: SortOrder
    key?: SortOrder
    accessor?: SortOrder
    missionId?: SortOrder
    stepId?: SortOrder
    accessedAt?: SortOrder
  }

  export type KnowledgeEdgeListRelationFilter = {
    every?: KnowledgeEdgeWhereInput
    some?: KnowledgeEdgeWhereInput
    none?: KnowledgeEdgeWhereInput
  }

  export type KnowledgeEdgeOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type KnowledgeNodeCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    type?: SortOrder
    label?: SortOrder
    description?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type KnowledgeNodeMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    type?: SortOrder
    label?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type KnowledgeNodeMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    type?: SortOrder
    label?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type KnowledgeNodeRelationFilter = {
    is?: KnowledgeNodeWhereInput
    isNot?: KnowledgeNodeWhereInput
  }

  export type KnowledgeEdgeCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    fromId?: SortOrder
    toId?: SortOrder
    relation?: SortOrder
    weight?: SortOrder
    source?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeEdgeAvgOrderByAggregateInput = {
    weight?: SortOrder
  }

  export type KnowledgeEdgeMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    fromId?: SortOrder
    toId?: SortOrder
    relation?: SortOrder
    weight?: SortOrder
    source?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeEdgeMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    fromId?: SortOrder
    toId?: SortOrder
    relation?: SortOrder
    weight?: SortOrder
    source?: SortOrder
    createdAt?: SortOrder
  }

  export type KnowledgeEdgeSumOrderByAggregateInput = {
    weight?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type MissionStepCreateNestedManyWithoutMissionInput = {
    create?: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput> | MissionStepCreateWithoutMissionInput[] | MissionStepUncheckedCreateWithoutMissionInput[]
    connectOrCreate?: MissionStepCreateOrConnectWithoutMissionInput | MissionStepCreateOrConnectWithoutMissionInput[]
    createMany?: MissionStepCreateManyMissionInputEnvelope
    connect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
  }

  export type MissionStepUncheckedCreateNestedManyWithoutMissionInput = {
    create?: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput> | MissionStepCreateWithoutMissionInput[] | MissionStepUncheckedCreateWithoutMissionInput[]
    connectOrCreate?: MissionStepCreateOrConnectWithoutMissionInput | MissionStepCreateOrConnectWithoutMissionInput[]
    createMany?: MissionStepCreateManyMissionInputEnvelope
    connect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type MissionStepUpdateManyWithoutMissionNestedInput = {
    create?: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput> | MissionStepCreateWithoutMissionInput[] | MissionStepUncheckedCreateWithoutMissionInput[]
    connectOrCreate?: MissionStepCreateOrConnectWithoutMissionInput | MissionStepCreateOrConnectWithoutMissionInput[]
    upsert?: MissionStepUpsertWithWhereUniqueWithoutMissionInput | MissionStepUpsertWithWhereUniqueWithoutMissionInput[]
    createMany?: MissionStepCreateManyMissionInputEnvelope
    set?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    disconnect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    delete?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    connect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    update?: MissionStepUpdateWithWhereUniqueWithoutMissionInput | MissionStepUpdateWithWhereUniqueWithoutMissionInput[]
    updateMany?: MissionStepUpdateManyWithWhereWithoutMissionInput | MissionStepUpdateManyWithWhereWithoutMissionInput[]
    deleteMany?: MissionStepScalarWhereInput | MissionStepScalarWhereInput[]
  }

  export type MissionStepUncheckedUpdateManyWithoutMissionNestedInput = {
    create?: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput> | MissionStepCreateWithoutMissionInput[] | MissionStepUncheckedCreateWithoutMissionInput[]
    connectOrCreate?: MissionStepCreateOrConnectWithoutMissionInput | MissionStepCreateOrConnectWithoutMissionInput[]
    upsert?: MissionStepUpsertWithWhereUniqueWithoutMissionInput | MissionStepUpsertWithWhereUniqueWithoutMissionInput[]
    createMany?: MissionStepCreateManyMissionInputEnvelope
    set?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    disconnect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    delete?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    connect?: MissionStepWhereUniqueInput | MissionStepWhereUniqueInput[]
    update?: MissionStepUpdateWithWhereUniqueWithoutMissionInput | MissionStepUpdateWithWhereUniqueWithoutMissionInput[]
    updateMany?: MissionStepUpdateManyWithWhereWithoutMissionInput | MissionStepUpdateManyWithWhereWithoutMissionInput[]
    deleteMany?: MissionStepScalarWhereInput | MissionStepScalarWhereInput[]
  }

  export type MissionStepCreatedependsOnInput = {
    set: string[]
  }

  export type MissionCreateNestedOneWithoutStepsInput = {
    create?: XOR<MissionCreateWithoutStepsInput, MissionUncheckedCreateWithoutStepsInput>
    connectOrCreate?: MissionCreateOrConnectWithoutStepsInput
    connect?: MissionWhereUniqueInput
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type MissionStepUpdatedependsOnInput = {
    set?: string[]
    push?: string | string[]
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type MissionUpdateOneRequiredWithoutStepsNestedInput = {
    create?: XOR<MissionCreateWithoutStepsInput, MissionUncheckedCreateWithoutStepsInput>
    connectOrCreate?: MissionCreateOrConnectWithoutStepsInput
    upsert?: MissionUpsertWithoutStepsInput
    connect?: MissionWhereUniqueInput
    update?: XOR<XOR<MissionUpdateToOneWithWhereWithoutStepsInput, MissionUpdateWithoutStepsInput>, MissionUncheckedUpdateWithoutStepsInput>
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type KnowledgeEdgeCreateNestedManyWithoutFromInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput> | KnowledgeEdgeCreateWithoutFromInput[] | KnowledgeEdgeUncheckedCreateWithoutFromInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutFromInput | KnowledgeEdgeCreateOrConnectWithoutFromInput[]
    createMany?: KnowledgeEdgeCreateManyFromInputEnvelope
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
  }

  export type KnowledgeEdgeCreateNestedManyWithoutToInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput> | KnowledgeEdgeCreateWithoutToInput[] | KnowledgeEdgeUncheckedCreateWithoutToInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutToInput | KnowledgeEdgeCreateOrConnectWithoutToInput[]
    createMany?: KnowledgeEdgeCreateManyToInputEnvelope
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
  }

  export type KnowledgeEdgeUncheckedCreateNestedManyWithoutFromInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput> | KnowledgeEdgeCreateWithoutFromInput[] | KnowledgeEdgeUncheckedCreateWithoutFromInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutFromInput | KnowledgeEdgeCreateOrConnectWithoutFromInput[]
    createMany?: KnowledgeEdgeCreateManyFromInputEnvelope
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
  }

  export type KnowledgeEdgeUncheckedCreateNestedManyWithoutToInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput> | KnowledgeEdgeCreateWithoutToInput[] | KnowledgeEdgeUncheckedCreateWithoutToInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutToInput | KnowledgeEdgeCreateOrConnectWithoutToInput[]
    createMany?: KnowledgeEdgeCreateManyToInputEnvelope
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
  }

  export type KnowledgeEdgeUpdateManyWithoutFromNestedInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput> | KnowledgeEdgeCreateWithoutFromInput[] | KnowledgeEdgeUncheckedCreateWithoutFromInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutFromInput | KnowledgeEdgeCreateOrConnectWithoutFromInput[]
    upsert?: KnowledgeEdgeUpsertWithWhereUniqueWithoutFromInput | KnowledgeEdgeUpsertWithWhereUniqueWithoutFromInput[]
    createMany?: KnowledgeEdgeCreateManyFromInputEnvelope
    set?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    disconnect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    delete?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    update?: KnowledgeEdgeUpdateWithWhereUniqueWithoutFromInput | KnowledgeEdgeUpdateWithWhereUniqueWithoutFromInput[]
    updateMany?: KnowledgeEdgeUpdateManyWithWhereWithoutFromInput | KnowledgeEdgeUpdateManyWithWhereWithoutFromInput[]
    deleteMany?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
  }

  export type KnowledgeEdgeUpdateManyWithoutToNestedInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput> | KnowledgeEdgeCreateWithoutToInput[] | KnowledgeEdgeUncheckedCreateWithoutToInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutToInput | KnowledgeEdgeCreateOrConnectWithoutToInput[]
    upsert?: KnowledgeEdgeUpsertWithWhereUniqueWithoutToInput | KnowledgeEdgeUpsertWithWhereUniqueWithoutToInput[]
    createMany?: KnowledgeEdgeCreateManyToInputEnvelope
    set?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    disconnect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    delete?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    update?: KnowledgeEdgeUpdateWithWhereUniqueWithoutToInput | KnowledgeEdgeUpdateWithWhereUniqueWithoutToInput[]
    updateMany?: KnowledgeEdgeUpdateManyWithWhereWithoutToInput | KnowledgeEdgeUpdateManyWithWhereWithoutToInput[]
    deleteMany?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
  }

  export type KnowledgeEdgeUncheckedUpdateManyWithoutFromNestedInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput> | KnowledgeEdgeCreateWithoutFromInput[] | KnowledgeEdgeUncheckedCreateWithoutFromInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutFromInput | KnowledgeEdgeCreateOrConnectWithoutFromInput[]
    upsert?: KnowledgeEdgeUpsertWithWhereUniqueWithoutFromInput | KnowledgeEdgeUpsertWithWhereUniqueWithoutFromInput[]
    createMany?: KnowledgeEdgeCreateManyFromInputEnvelope
    set?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    disconnect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    delete?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    update?: KnowledgeEdgeUpdateWithWhereUniqueWithoutFromInput | KnowledgeEdgeUpdateWithWhereUniqueWithoutFromInput[]
    updateMany?: KnowledgeEdgeUpdateManyWithWhereWithoutFromInput | KnowledgeEdgeUpdateManyWithWhereWithoutFromInput[]
    deleteMany?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
  }

  export type KnowledgeEdgeUncheckedUpdateManyWithoutToNestedInput = {
    create?: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput> | KnowledgeEdgeCreateWithoutToInput[] | KnowledgeEdgeUncheckedCreateWithoutToInput[]
    connectOrCreate?: KnowledgeEdgeCreateOrConnectWithoutToInput | KnowledgeEdgeCreateOrConnectWithoutToInput[]
    upsert?: KnowledgeEdgeUpsertWithWhereUniqueWithoutToInput | KnowledgeEdgeUpsertWithWhereUniqueWithoutToInput[]
    createMany?: KnowledgeEdgeCreateManyToInputEnvelope
    set?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    disconnect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    delete?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    connect?: KnowledgeEdgeWhereUniqueInput | KnowledgeEdgeWhereUniqueInput[]
    update?: KnowledgeEdgeUpdateWithWhereUniqueWithoutToInput | KnowledgeEdgeUpdateWithWhereUniqueWithoutToInput[]
    updateMany?: KnowledgeEdgeUpdateManyWithWhereWithoutToInput | KnowledgeEdgeUpdateManyWithWhereWithoutToInput[]
    deleteMany?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
  }

  export type KnowledgeNodeCreateNestedOneWithoutOutEdgesInput = {
    create?: XOR<KnowledgeNodeCreateWithoutOutEdgesInput, KnowledgeNodeUncheckedCreateWithoutOutEdgesInput>
    connectOrCreate?: KnowledgeNodeCreateOrConnectWithoutOutEdgesInput
    connect?: KnowledgeNodeWhereUniqueInput
  }

  export type KnowledgeNodeCreateNestedOneWithoutInEdgesInput = {
    create?: XOR<KnowledgeNodeCreateWithoutInEdgesInput, KnowledgeNodeUncheckedCreateWithoutInEdgesInput>
    connectOrCreate?: KnowledgeNodeCreateOrConnectWithoutInEdgesInput
    connect?: KnowledgeNodeWhereUniqueInput
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type KnowledgeNodeUpdateOneRequiredWithoutOutEdgesNestedInput = {
    create?: XOR<KnowledgeNodeCreateWithoutOutEdgesInput, KnowledgeNodeUncheckedCreateWithoutOutEdgesInput>
    connectOrCreate?: KnowledgeNodeCreateOrConnectWithoutOutEdgesInput
    upsert?: KnowledgeNodeUpsertWithoutOutEdgesInput
    connect?: KnowledgeNodeWhereUniqueInput
    update?: XOR<XOR<KnowledgeNodeUpdateToOneWithWhereWithoutOutEdgesInput, KnowledgeNodeUpdateWithoutOutEdgesInput>, KnowledgeNodeUncheckedUpdateWithoutOutEdgesInput>
  }

  export type KnowledgeNodeUpdateOneRequiredWithoutInEdgesNestedInput = {
    create?: XOR<KnowledgeNodeCreateWithoutInEdgesInput, KnowledgeNodeUncheckedCreateWithoutInEdgesInput>
    connectOrCreate?: KnowledgeNodeCreateOrConnectWithoutInEdgesInput
    upsert?: KnowledgeNodeUpsertWithoutInEdgesInput
    connect?: KnowledgeNodeWhereUniqueInput
    update?: XOR<XOR<KnowledgeNodeUpdateToOneWithWhereWithoutInEdgesInput, KnowledgeNodeUpdateWithoutInEdgesInput>, KnowledgeNodeUncheckedUpdateWithoutInEdgesInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }
  export type NestedJsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type MissionStepCreateWithoutMissionInput = {
    id?: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MissionStepUncheckedCreateWithoutMissionInput = {
    id?: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MissionStepCreateOrConnectWithoutMissionInput = {
    where: MissionStepWhereUniqueInput
    create: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput>
  }

  export type MissionStepCreateManyMissionInputEnvelope = {
    data: MissionStepCreateManyMissionInput | MissionStepCreateManyMissionInput[]
    skipDuplicates?: boolean
  }

  export type MissionStepUpsertWithWhereUniqueWithoutMissionInput = {
    where: MissionStepWhereUniqueInput
    update: XOR<MissionStepUpdateWithoutMissionInput, MissionStepUncheckedUpdateWithoutMissionInput>
    create: XOR<MissionStepCreateWithoutMissionInput, MissionStepUncheckedCreateWithoutMissionInput>
  }

  export type MissionStepUpdateWithWhereUniqueWithoutMissionInput = {
    where: MissionStepWhereUniqueInput
    data: XOR<MissionStepUpdateWithoutMissionInput, MissionStepUncheckedUpdateWithoutMissionInput>
  }

  export type MissionStepUpdateManyWithWhereWithoutMissionInput = {
    where: MissionStepScalarWhereInput
    data: XOR<MissionStepUpdateManyMutationInput, MissionStepUncheckedUpdateManyWithoutMissionInput>
  }

  export type MissionStepScalarWhereInput = {
    AND?: MissionStepScalarWhereInput | MissionStepScalarWhereInput[]
    OR?: MissionStepScalarWhereInput[]
    NOT?: MissionStepScalarWhereInput | MissionStepScalarWhereInput[]
    id?: StringFilter<"MissionStep"> | string
    missionId?: StringFilter<"MissionStep"> | string
    title?: StringFilter<"MissionStep"> | string
    status?: StringFilter<"MissionStep"> | string
    skillId?: StringNullableFilter<"MissionStep"> | string | null
    prompt?: StringNullableFilter<"MissionStep"> | string | null
    input?: JsonFilter<"MissionStep">
    output?: JsonNullableFilter<"MissionStep">
    dependsOn?: StringNullableListFilter<"MissionStep">
    retries?: IntFilter<"MissionStep"> | number
    executor?: StringFilter<"MissionStep"> | string
    approvalGateId?: StringNullableFilter<"MissionStep"> | string | null
    startedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    completedAt?: DateTimeNullableFilter<"MissionStep"> | Date | string | null
    createdAt?: DateTimeFilter<"MissionStep"> | Date | string
    updatedAt?: DateTimeFilter<"MissionStep"> | Date | string
  }

  export type MissionCreateWithoutStepsInput = {
    id?: string
    projectId: string
    title: string
    objective: string
    status?: string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    updatedAt?: Date | string
  }

  export type MissionUncheckedCreateWithoutStepsInput = {
    id?: string
    projectId: string
    title: string
    objective: string
    status?: string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    updatedAt?: Date | string
  }

  export type MissionCreateOrConnectWithoutStepsInput = {
    where: MissionWhereUniqueInput
    create: XOR<MissionCreateWithoutStepsInput, MissionUncheckedCreateWithoutStepsInput>
  }

  export type MissionUpsertWithoutStepsInput = {
    update: XOR<MissionUpdateWithoutStepsInput, MissionUncheckedUpdateWithoutStepsInput>
    create: XOR<MissionCreateWithoutStepsInput, MissionUncheckedCreateWithoutStepsInput>
    where?: MissionWhereInput
  }

  export type MissionUpdateToOneWithWhereWithoutStepsInput = {
    where?: MissionWhereInput
    data: XOR<MissionUpdateWithoutStepsInput, MissionUncheckedUpdateWithoutStepsInput>
  }

  export type MissionUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionUncheckedUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    objective?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    context?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeCreateWithoutFromInput = {
    id?: string
    projectId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
    to: KnowledgeNodeCreateNestedOneWithoutInEdgesInput
  }

  export type KnowledgeEdgeUncheckedCreateWithoutFromInput = {
    id?: string
    projectId: string
    toId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeCreateOrConnectWithoutFromInput = {
    where: KnowledgeEdgeWhereUniqueInput
    create: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput>
  }

  export type KnowledgeEdgeCreateManyFromInputEnvelope = {
    data: KnowledgeEdgeCreateManyFromInput | KnowledgeEdgeCreateManyFromInput[]
    skipDuplicates?: boolean
  }

  export type KnowledgeEdgeCreateWithoutToInput = {
    id?: string
    projectId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
    from: KnowledgeNodeCreateNestedOneWithoutOutEdgesInput
  }

  export type KnowledgeEdgeUncheckedCreateWithoutToInput = {
    id?: string
    projectId: string
    fromId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeCreateOrConnectWithoutToInput = {
    where: KnowledgeEdgeWhereUniqueInput
    create: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput>
  }

  export type KnowledgeEdgeCreateManyToInputEnvelope = {
    data: KnowledgeEdgeCreateManyToInput | KnowledgeEdgeCreateManyToInput[]
    skipDuplicates?: boolean
  }

  export type KnowledgeEdgeUpsertWithWhereUniqueWithoutFromInput = {
    where: KnowledgeEdgeWhereUniqueInput
    update: XOR<KnowledgeEdgeUpdateWithoutFromInput, KnowledgeEdgeUncheckedUpdateWithoutFromInput>
    create: XOR<KnowledgeEdgeCreateWithoutFromInput, KnowledgeEdgeUncheckedCreateWithoutFromInput>
  }

  export type KnowledgeEdgeUpdateWithWhereUniqueWithoutFromInput = {
    where: KnowledgeEdgeWhereUniqueInput
    data: XOR<KnowledgeEdgeUpdateWithoutFromInput, KnowledgeEdgeUncheckedUpdateWithoutFromInput>
  }

  export type KnowledgeEdgeUpdateManyWithWhereWithoutFromInput = {
    where: KnowledgeEdgeScalarWhereInput
    data: XOR<KnowledgeEdgeUpdateManyMutationInput, KnowledgeEdgeUncheckedUpdateManyWithoutFromInput>
  }

  export type KnowledgeEdgeScalarWhereInput = {
    AND?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
    OR?: KnowledgeEdgeScalarWhereInput[]
    NOT?: KnowledgeEdgeScalarWhereInput | KnowledgeEdgeScalarWhereInput[]
    id?: StringFilter<"KnowledgeEdge"> | string
    projectId?: StringFilter<"KnowledgeEdge"> | string
    fromId?: StringFilter<"KnowledgeEdge"> | string
    toId?: StringFilter<"KnowledgeEdge"> | string
    relation?: StringFilter<"KnowledgeEdge"> | string
    weight?: FloatFilter<"KnowledgeEdge"> | number
    source?: StringFilter<"KnowledgeEdge"> | string
    createdAt?: DateTimeFilter<"KnowledgeEdge"> | Date | string
  }

  export type KnowledgeEdgeUpsertWithWhereUniqueWithoutToInput = {
    where: KnowledgeEdgeWhereUniqueInput
    update: XOR<KnowledgeEdgeUpdateWithoutToInput, KnowledgeEdgeUncheckedUpdateWithoutToInput>
    create: XOR<KnowledgeEdgeCreateWithoutToInput, KnowledgeEdgeUncheckedCreateWithoutToInput>
  }

  export type KnowledgeEdgeUpdateWithWhereUniqueWithoutToInput = {
    where: KnowledgeEdgeWhereUniqueInput
    data: XOR<KnowledgeEdgeUpdateWithoutToInput, KnowledgeEdgeUncheckedUpdateWithoutToInput>
  }

  export type KnowledgeEdgeUpdateManyWithWhereWithoutToInput = {
    where: KnowledgeEdgeScalarWhereInput
    data: XOR<KnowledgeEdgeUpdateManyMutationInput, KnowledgeEdgeUncheckedUpdateManyWithoutToInput>
  }

  export type KnowledgeNodeCreateWithoutOutEdgesInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    inEdges?: KnowledgeEdgeCreateNestedManyWithoutToInput
  }

  export type KnowledgeNodeUncheckedCreateWithoutOutEdgesInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    inEdges?: KnowledgeEdgeUncheckedCreateNestedManyWithoutToInput
  }

  export type KnowledgeNodeCreateOrConnectWithoutOutEdgesInput = {
    where: KnowledgeNodeWhereUniqueInput
    create: XOR<KnowledgeNodeCreateWithoutOutEdgesInput, KnowledgeNodeUncheckedCreateWithoutOutEdgesInput>
  }

  export type KnowledgeNodeCreateWithoutInEdgesInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    outEdges?: KnowledgeEdgeCreateNestedManyWithoutFromInput
  }

  export type KnowledgeNodeUncheckedCreateWithoutInEdgesInput = {
    id?: string
    projectId: string
    type: string
    label: string
    description?: string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    outEdges?: KnowledgeEdgeUncheckedCreateNestedManyWithoutFromInput
  }

  export type KnowledgeNodeCreateOrConnectWithoutInEdgesInput = {
    where: KnowledgeNodeWhereUniqueInput
    create: XOR<KnowledgeNodeCreateWithoutInEdgesInput, KnowledgeNodeUncheckedCreateWithoutInEdgesInput>
  }

  export type KnowledgeNodeUpsertWithoutOutEdgesInput = {
    update: XOR<KnowledgeNodeUpdateWithoutOutEdgesInput, KnowledgeNodeUncheckedUpdateWithoutOutEdgesInput>
    create: XOR<KnowledgeNodeCreateWithoutOutEdgesInput, KnowledgeNodeUncheckedCreateWithoutOutEdgesInput>
    where?: KnowledgeNodeWhereInput
  }

  export type KnowledgeNodeUpdateToOneWithWhereWithoutOutEdgesInput = {
    where?: KnowledgeNodeWhereInput
    data: XOR<KnowledgeNodeUpdateWithoutOutEdgesInput, KnowledgeNodeUncheckedUpdateWithoutOutEdgesInput>
  }

  export type KnowledgeNodeUpdateWithoutOutEdgesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    inEdges?: KnowledgeEdgeUpdateManyWithoutToNestedInput
  }

  export type KnowledgeNodeUncheckedUpdateWithoutOutEdgesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    inEdges?: KnowledgeEdgeUncheckedUpdateManyWithoutToNestedInput
  }

  export type KnowledgeNodeUpsertWithoutInEdgesInput = {
    update: XOR<KnowledgeNodeUpdateWithoutInEdgesInput, KnowledgeNodeUncheckedUpdateWithoutInEdgesInput>
    create: XOR<KnowledgeNodeCreateWithoutInEdgesInput, KnowledgeNodeUncheckedCreateWithoutInEdgesInput>
    where?: KnowledgeNodeWhereInput
  }

  export type KnowledgeNodeUpdateToOneWithWhereWithoutInEdgesInput = {
    where?: KnowledgeNodeWhereInput
    data: XOR<KnowledgeNodeUpdateWithoutInEdgesInput, KnowledgeNodeUncheckedUpdateWithoutInEdgesInput>
  }

  export type KnowledgeNodeUpdateWithoutInEdgesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    outEdges?: KnowledgeEdgeUpdateManyWithoutFromNestedInput
  }

  export type KnowledgeNodeUncheckedUpdateWithoutInEdgesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    label?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    outEdges?: KnowledgeEdgeUncheckedUpdateManyWithoutFromNestedInput
  }

  export type MissionStepCreateManyMissionInput = {
    id?: string
    title: string
    status?: string
    skillId?: string | null
    prompt?: string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepCreatedependsOnInput | string[]
    retries?: number
    executor?: string
    approvalGateId?: string | null
    startedAt?: Date | string | null
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MissionStepUpdateWithoutMissionInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionStepUncheckedUpdateWithoutMissionInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MissionStepUncheckedUpdateManyWithoutMissionInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    skillId?: NullableStringFieldUpdateOperationsInput | string | null
    prompt?: NullableStringFieldUpdateOperationsInput | string | null
    input?: JsonNullValueInput | InputJsonValue
    output?: NullableJsonNullValueInput | InputJsonValue
    dependsOn?: MissionStepUpdatedependsOnInput | string[]
    retries?: IntFieldUpdateOperationsInput | number
    executor?: StringFieldUpdateOperationsInput | string
    approvalGateId?: NullableStringFieldUpdateOperationsInput | string | null
    startedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeCreateManyFromInput = {
    id?: string
    projectId: string
    toId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeCreateManyToInput = {
    id?: string
    projectId: string
    fromId: string
    relation: string
    weight?: number
    source?: string
    createdAt?: Date | string
  }

  export type KnowledgeEdgeUpdateWithoutFromInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    to?: KnowledgeNodeUpdateOneRequiredWithoutInEdgesNestedInput
  }

  export type KnowledgeEdgeUncheckedUpdateWithoutFromInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    toId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeUncheckedUpdateManyWithoutFromInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    toId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeUpdateWithoutToInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    from?: KnowledgeNodeUpdateOneRequiredWithoutOutEdgesNestedInput
  }

  export type KnowledgeEdgeUncheckedUpdateWithoutToInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    fromId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type KnowledgeEdgeUncheckedUpdateManyWithoutToInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    fromId?: StringFieldUpdateOperationsInput | string
    relation?: StringFieldUpdateOperationsInput | string
    weight?: FloatFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use MissionCountOutputTypeDefaultArgs instead
     */
    export type MissionCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MissionCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeNodeCountOutputTypeDefaultArgs instead
     */
    export type KnowledgeNodeCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeNodeCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use MissionDefaultArgs instead
     */
    export type MissionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MissionDefaultArgs<ExtArgs>
    /**
     * @deprecated Use MissionStepDefaultArgs instead
     */
    export type MissionStepArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MissionStepDefaultArgs<ExtArgs>
    /**
     * @deprecated Use MemoryMetaDefaultArgs instead
     */
    export type MemoryMetaArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MemoryMetaDefaultArgs<ExtArgs>
    /**
     * @deprecated Use VaultAccessLogDefaultArgs instead
     */
    export type VaultAccessLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = VaultAccessLogDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeNodeDefaultArgs instead
     */
    export type KnowledgeNodeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeNodeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use KnowledgeEdgeDefaultArgs instead
     */
    export type KnowledgeEdgeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = KnowledgeEdgeDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}