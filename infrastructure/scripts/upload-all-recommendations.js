const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient({ region: 'eu-west-1' });

const TABLE_NAME = 'trinity-recommendations';

// Las 70 películas completas
const allMovies = [
  // Contra el Acoso Escolar (10 películas)
  {
    categoryId: 'anti-bullying',
    movieId: 1001,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Wonder',
    posterPath: '/ouYgAatYH7ynpAZER7A7PoKBCiw.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/ouYgAatYH7ynpAZER7A7PoKBCiw.jpg',
    year: '2017',
    description: 'Auggie Pullman, un niño con diferencias faciales, enfrenta el bullying al entrar a la escuela.',
    trailerKey: 'ngiK8qjq4MA'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1002,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Karate Kid',
    posterPath: '/4gLFKsalwRy0ONzfYaRsKr5wilK.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/4gLFKsalwRy0ONzfYaRsKr5wilK.jpg',
    year: '1984',
    description: 'Un adolescente aprende artes marciales para defenderse de los acosadores.',
    trailerKey: 'r8q6vTijil0'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1003,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'A Silent Voice',
    posterPath: '/tuFaWiqX0TXoWu7DGNcmX3UW7sT.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/tuFaWiqX0TXoWu7DGNcmX3UW7sT.jpg',
    year: '2016',
    description: 'Un antiguo acosador intenta redimirse acercándose a la chica sorda a la que intimidó en la escuela primaria.',
    trailerKey: 'nfK6UgLra7g'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1004,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Moonlight',
    posterPath: '/qAwFbs5OppYk2d0b5q2Z1z3i5oK.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/qAwFbs5OppYk2d0b5q2Z1z3i5oK.jpg',
    year: '2016',
    description: 'Un joven afroamericano lidia con su identidad y sexualidad mientras experimenta el acoso en su infancia.',
    trailerKey: '9NJj12tJzqc'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1005,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Chicas Pesadas',
    posterPath: '/hYq65j1qZF6qV1F.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/hYq65j1qZF6qV1F.jpg',
    year: '2004',
    description: 'Cady Heron se une a "Las Plásticas", el grupo más popular y cruel de la escuela, aprendiendo el costo de la popularidad.',
    trailerKey: 'KAOmTMCtGkI'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1006,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Billy Elliot',
    posterPath: '/3G6.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/3G6.jpg',
    year: '2000',
    description: 'Un niño lucha contra los estereotipos y el rechazo de su comunidad para perseguir su sueño de ser bailarín.',
    trailerKey: 'phCE1bW7Qc'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1007,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Precious',
    posterPath: '/jK.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/jK.jpg',
    year: '2009',
    description: 'Una adolescente obesa y analfabeta embarazada de su padre sufre abusos, pero encuentra esperanza en una escuela alternativa.',
    trailerKey: 'b5fY9.jpg'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1008,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Cyberbully',
    posterPath: '/3.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/3.jpg',
    year: '2011',
    description: 'Una adolescente es víctima de acoso cibernético y debe lidiar con las consecuencias emocionales y sociales.',
    trailerKey: '4.jpg'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1009,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Elephant',
    posterPath: '/p.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/p.jpg',
    year: '2003',
    description: 'Una mirada a la vida de varios estudiantes de secundaria antes de un trágico tiroteo escolar motivado por el acoso.',
    trailerKey: 'ht.jpg'
  },
  {
    categoryId: 'anti-bullying',
    movieId: 1010,
    categoryTitle: 'Contra el Acoso Escolar',
    categoryDescription: 'Películas que abordan el bullying y promueven la empatía',
    title: 'Un Monstruo Viene a Verme',
    posterPath: '/o.jpg',
    alternativePosterUrl: 'https://image.tmdb.org/t/p/original/o.jpg',
    year: '2016',
    description: 'Connor lidia con la enfermedad de su madre y el acoso escolar con la ayuda de un monstruo fantástico.',
    trailerKey: 'R.jpg'
  },

  // Contra la Violencia de Género (10 películas)
