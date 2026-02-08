// Script to populate trinity-recommendations table with social/sustainable movie data
// Run with: node infrastructure/scripts/populate-recommendations.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'eu-west-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'trinity-recommendations';

// Original recommendations data with Spanish translations
const recommendations = [
  {
    categoryId: 'anti-bullying',
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    movies: [
      {
        movieId: 1001,
        title: 'Wonder',
        posterPath: '/ouYgAatYH7ynpAZER7A7PoKBCiw.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BYmRmOTZjNzMtMjc0Yi00NTg2LWI5ZTctMjk0ZjI5YWQwYzY5XkEyXkFqcGc@._V1_SX300.jpg',
        year: '2017',
        description: 'Auggie Pullman, un niño con diferencias faciales, enfrenta el bullying al entrar a la escuela por primera vez y enseña a todos sobre la bondad.',
        trailerKey: 'ngiK8qjq4MA'
      },
      {
        movieId: 1002,
        title: 'Karate Kid',
        posterPath: '/4gLFKsalwRy0ONzfYaRsKr5wilK.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BNTkzY2YzNmYtY2ViMS00MThiLWFlYTEtOWQ1OTBiOGEwMTdhXkEyXkFqcGc@._V1_SX300.jpg',
        year: '1984',
        description: 'Un adolescente aprende artes marciales para defenderse de los acosadores.',
        trailerKey: 'r8q6vTijil0'
      },
      {
        movieId: 1003,
        title: 'Cyberbully',
        posterPath: '/8QJJKwJNuBXgHLcMCkpZnBcCvNH.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMTYxMzYwOTE4NV5BMl5BanBnXkFtZTcwNjk0MTI0Ng@@._V1_SX300.jpg',
        year: '2011',
        description: 'Una adolescente enfrenta los efectos devastadores del ciberacoso.',
        trailerKey: 'C_hEAuZLx8w'
      },
      {
        movieId: 1004,
        title: 'Chicas Pesadas',
        posterPath: '/fXm3YKXAEjx7d2tIWDg9TfRZtsU.jpg',
        year: '2004',
        description: 'Una nueva estudiante navega por la compleja jerarquía social de la escuela secundaria.',
        trailerKey: 'oDU84nmSDZY'
      }
    ]
  },
  {
    categoryId: 'environmental-awareness',
    categoryTitle: 'Conciencia Medioambiental',
    categoryDescription: 'Películas que destacan problemas ambientales y conservación',
    movies: [
      {
        movieId: 2001,
        title: 'WALL-E',
        posterPath: '/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg',
        year: '2008',
        description: 'Un robot dejado para limpiar la Tierra descubre la importancia del cuidado ambiental.',
        trailerKey: 'CZ1CATNbXg0'
      },
      {
        movieId: 2002,
        title: 'Una Verdad Incómoda',
        posterPath: '/ml8VLzOhkQdSCJhBTyOlayNzJkI.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMTg1NDk3NjE3OF5BMl5BanBnXkFtZTcwMzExMjIzMQ@@._V1_SX300.jpg',
        year: '2006',
        description: 'Al Gore presenta evidencia convincente sobre el cambio climático.',
        trailerKey: 'Bu6SE5TYrCM'
      },
      {
        movieId: 2003,
        title: 'El Lórax',
        posterPath: '/tePFnZFw5L7lQgGzFpZbTgR6RJh.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMmNhZjIyZTItOGU3Mi00ODI0LWEzZjctMzY5NjM5NmVlOGMyXkEyXkFqcGc@._V1_SX300.jpg',
        year: '2012',
        description: 'Un niño aprende sobre la protección ambiental del Lórax.',
        trailerKey: 'BREHMhSLScg'
      },
      {
        movieId: 2004,
        title: 'FernGully',
        posterPath: '/eTqb6NJmw8bVQP0LSLGFtJNjaqb.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BNjg3NjUyNjY3Nl5BMl5BanBnXkFtZTgwNDQ0NTQxMTE@._V1_SX300.jpg',
        year: '1992',
        description: 'Las hadas luchan por salvar su hogar en la selva tropical de la destrucción.',
        trailerKey: 'ur8B4JpNmjg'
      }
    ]
  },
  {
    categoryId: 'mental-health',
    categoryTitle: 'Salud Mental',
    categoryDescription: 'Historias que promueven la conciencia y el apoyo a la salud mental',
    movies: [
      {
        movieId: 3001,
        title: 'Intensamente',
        posterPath: '/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg',
        year: '2015',
        description: 'Un viaje a través de las emociones de una niña que lidia con el cambio.',
        trailerKey: 'yRUAzGQ3nSY'
      },
      {
        movieId: 3002,
        title: 'Una Mente Brillante',
        posterPath: '/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'La historia del matemático John Nash y su lucha contra la enfermedad mental.',
        trailerKey: 'YWwAOutgWBQ'
      },
      {
        movieId: 3003,
        title: 'El Indomable Will Hunting',
        posterPath: '/bABCBKYBK7A5G1x0FzoeoNfuj2.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BYTllYzJhMGYtMmJkNS00NGNiLWJiNGMtZDI3MjZlZGVmNzJjXkEyXkFqcGc@._V1_SX300.jpg',
        year: '1997',
        description: 'Un conserje con habilidades matemáticas extraordinarias recibe terapia.',
        trailerKey: 'PaZVjZEFkRs'
      },
      {
        movieId: 3004,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Un adolescente tímido encuentra amistad y aprende a lidiar con el trauma.',
        trailerKey: 'n5rh7O4IDc0'
      }
    ]
  },
  {
    categoryId: 'diversity-inclusion',
    categoryTitle: 'Diversidad e Inclusión',
    categoryDescription: 'Celebrando la diversidad y promoviendo la inclusión',
    movies: [
      {
        movieId: 4001,
        title: 'Coco',
        posterPath: '/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg',
        year: '2017',
        description: 'Un niño descubre su historia familiar y las tradiciones mexicanas.',
        trailerKey: 'Ga6RYejo6Hk'
      },
      {
        movieId: 4002,
        title: 'Pantera Negra',
        posterPath: '/uxzzxijgPIY7slzFvMotPv8wjKA.jpg',
        year: '2018',
        description: 'Una historia de superhéroes que celebra la cultura y herencia africana.',
        trailerKey: 'xjDjIWPwcPU'
      },
      {
        movieId: 4003,
        title: 'Moana',
        posterPath: '/4JeejGugONWpJkbnvL12hVoYEDa.jpg',
        year: '2016',
        description: 'Una princesa polinesia se embarca en un viaje para salvar su isla.',
        trailerKey: 'LKFuXETZUsI'
      },
      {
        movieId: 4004,
        title: 'Historias Cruzadas',
        posterPath: '/7XLSwxpfpPPZVEiB7VTMzUtzRdg.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMTQwMDQ4MTQ0N15BMl5BanBnXkFtZTcwMTYxNTg0Ng@@._V1_SX300.jpg',
        year: '2011',
        description: 'Empleadas domésticas afroamericanas comparten sus historias durante la era de los derechos civiles.',
        trailerKey: 'WfoN1qD_UXE'
      }
    ]
  },
  {
    categoryId: 'social-justice',
    categoryTitle: 'Justicia Social',
    categoryDescription: 'Películas que abordan problemas sociales y promueven la igualdad',
    movies: [
      {
        movieId: 5001,
        title: 'Selma',
        posterPath: '/wq4lhMB4WP8xVlbTNz8V1VQO5P8.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMzE5NTQzMTcyNl5BMl5BanBnXkFtZTgwMTAwNjU0MzE@._V1_SX300.jpg',
        year: '2014',
        description: 'La historia de Martin Luther King Jr. y las marchas por el derecho al voto en Selma.',
        trailerKey: 'x6t7vVTxaic'
      },
      {
        movieId: 5002,
        title: 'Figuras Ocultas',
        posterPath: '/9lfz2W2uGjyow3am00rsPJ8iOyq.jpg',
        year: '2016',
        description: 'Matemáticas afroamericanas en la NASA durante la carrera espacial.',
        trailerKey: 'RK8xHq6dfAo'
      },
      {
        movieId: 5003,
        title: 'Matar a un Ruiseñor',
        posterPath: '/hKbhJJRRZOUP4Ky7TcXBBaLNzB4.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BNmVmYzcxMzctYzYwMi00NWQxLWI0ZjYtNjk0ZjM0ZjZlNjdkXkEyXkFqcGc@._V1_SX300.jpg',
        year: '1962',
        description: 'Un abogado defiende a un hombre negro en un juicio con carga racial.',
        trailerKey: 'KR7loA_oziY'
      },
      {
        movieId: 5004,
        title: 'El Odio que Das',
        posterPath: '/2icwBom0t5nmOuZI9FVXF3gkMK0.jpg',
        year: '2018',
        description: 'Una adolescente presencia brutalidad policial y encuentra su voz.',
        trailerKey: 'W0DwUL00lXE'
      }
    ]
  },
  {
    categoryId: 'education-empowerment',
    categoryTitle: 'Educación y Empoderamiento',
    categoryDescription: 'Historias sobre el poder de la educación y el crecimiento personal',
    movies: [
      {
        movieId: 6001,
        title: 'La Sociedad de los Poetas Muertos',
        posterPath: '/ai40gM7SUaGA2pPvbBmRe8Ew8wN.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BOGYwYWNjMzgtNGU4ZC00NWQ2LWEwZjUtMzE1Zjc3NjY3YTU1XkEyXkFqcGc@._V1_SX300.jpg',
        year: '1989',
        description: 'Un maestro inspirador anima a los estudiantes a pensar por sí mismos.',
        trailerKey: 'ye5zn94D5Ck'
      },
      {
        movieId: 6002,
        title: 'Escritores de la Libertad',
        posterPath: '/7sOgj2mNqHBUXq6M1ESWGlHZG8c.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BYTRhNjE0NTUtYzRlNS00MTYyLWFjZjQtNjk0ZjM0ZjZlNjdkXkEyXkFqcGc@._V1_SX300.jpg',
        year: '2007',
        description: 'Una maestra transforma las vidas de sus estudiantes a través de la escritura.',
        trailerKey: 'A3E0rAP4m1E'
      },
      {
        movieId: 6003,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Un padre lucha por construir una vida mejor para su hijo.',
        trailerKey: 'x8-7mHT9edg'
      },
      {
        movieId: 6004,
        title: 'Matilda',
        posterPath: '/lqiLtJi0WkMASuGGaygq1feVOTr.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BYzc5ZTI5NTMtMzBhZi00NTZmLWI4NzUtZjQ5ZjE0MzY5YmE5XkEyXkFqcGc@._V1_SX300.jpg',
        year: '1996',
        description: 'Una niña dotada usa su inteligencia para superar la adversidad.',
        trailerKey: 'Aq3Wz5p93MA'
      }
    ]
  },
  {
    categoryId: 'community-support',
    categoryTitle: 'Apoyo Comunitario',
    categoryDescription: 'Películas sobre la importancia de la comunidad y ayudar a otros',
    movies: [
      {
        movieId: 7001,
        title: 'Qué Bello es Vivir',
        posterPath: '/bSqt9rhDZx1Q7UZ86dBPKdNomp2.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BZjc4NDZhZWMtNGEzYS00ZWU2LThlM2ItNTA0YzQ0OTExMTE2XkEyXkFqcGc@._V1_SX300.jpg',
        year: '1946',
        description: 'Un hombre descubre cuánto ha tocado su vida a los demás.',
        trailerKey: 'iLR3gZrU2Xo'
      },
      {
        movieId: 7002,
        title: 'Cadena de Favores',
        posterPath: '/2dABNdJRSaXaVlmLqJkKgOJXVL7.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BMTQwMDQ4MTQ0N15BMl5BanBnXkFtZTcwMTYxNTg0Ng@@._V1_SX300.jpg',
        year: '2000',
        description: 'Un niño inicia un movimiento de bondad que se extiende por todo el país.',
        trailerKey: 'Gu_7bBJmJWs'
      },
      {
        movieId: 7003,
        title: 'Un Sueño Posible',
        posterPath: '/k2MKCf6fLbuXdOKuvaG5jc6NbJq.jpg',
        year: '2009',
        description: 'Una familia acoge a un adolescente sin hogar y cambia su vida.',
        trailerKey: 'gvqJ_JfUDVs'
      },
      {
        movieId: 7004,
        title: 'Duelo de Titanes',
        posterPath: '/pAa5mVvB8eLOyNJzqjwjkzjOqbG.jpg',
        alternativePosterUrl: 'https://m.media-amazon.com/images/M/MV5BYThkMzgxNjEtMzFiOC00MTI0LWI0NjUtYzJlYjY1ZGNmMjdhXkEyXkFqcGc@._V1_SX300.jpg',
        year: '2000',
        description: 'Un equipo de fútbol supera las tensiones raciales para unirse como uno.',
        trailerKey: 'IhqGtxGkHlw'
      }
    ]
  }
];

async function populateTable() {
  console.log('🚀 Starting to populate recommendations table...\n');

  let totalInserted = 0;
  let totalErrors = 0;

  for (const category of recommendations) {
    console.log(`📁 Processing category: ${category.categoryTitle}`);
    
    for (const movie of category.movies) {
      try {
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              categoryId: category.categoryId,
              movieId: movie.movieId,
              categoryTitle: category.categoryTitle,
              categoryDescription: category.categoryDescription,
              title: movie.title,
              posterPath: movie.posterPath,
              alternativePosterUrl: movie.alternativePosterUrl || null,
              year: movie.year,
              description: movie.description,
              trailerKey: movie.trailerKey || null,
            },
          })
        );
        
        console.log(`  ✅ Inserted: ${movie.title} (${movie.year})`);
        totalInserted++;
      } catch (error) {
        console.error(`  ❌ Error inserting ${movie.title}:`, error.message);
        totalErrors++;
      }
    }
    
    console.log('');
  }

  console.log('📊 Summary:');
  console.log(`  Total inserted: ${totalInserted}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Categories: ${recommendations.length}`);
  console.log('\n✅ Done!');
}

// Verify table contents
async function verifyTable() {
  console.log('\n🔍 Verifying table contents...\n');

  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
    })
  );

  console.log(`Total items in table: ${result.Items.length}`);
  
  // Group by category
  const categoriesMap = new Map();
  for (const item of result.Items) {
    if (!categoriesMap.has(item.categoryId)) {
      categoriesMap.set(item.categoryId, []);
    }
    categoriesMap.get(item.categoryId).push(item);
  }

  console.log(`\nCategories found: ${categoriesMap.size}`);
  for (const [categoryId, movies] of categoriesMap) {
    console.log(`  - ${categoryId}: ${movies.length} movies`);
  }
}

// Run the script
(async () => {
  try {
    await populateTable();
    await verifyTable();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();
