// Static Social Recommendations Data
// Zero latency - no API calls

export interface RecommendationMovie {
  id: number;
  title: string;
  posterPath: string;
  year: string;
  description: string;
}

export interface RecommendationCategory {
  id: string;
  title: string;
  description: string;
  movies: RecommendationMovie[];
}

export const staticRecommendations: RecommendationCategory[] = [
  {
    id: 'stop-bullying',
    title: 'Stop Bullying',
    description: 'Movies that address bullying and promote kindness',
    movies: [
      {
        id: 1001,
        title: 'Wonder',
        posterPath: 'https://image.tmdb.org/t/p/w500/ouYgAatYH7ynpAZER7A7PoKBCiw.jpg',
        year: '2017',
        description: 'A boy with facial differences enters fifth grade, teaching others about kindness and acceptance.'
      },
      {
        id: 1002,
        title: 'The Karate Kid',
        posterPath: 'https://image.tmdb.org/t/p/w500/4gLFKsalwRy0ONzfYaRsKr5wilK.jpg',
        year: '1984',
        description: 'A teenager learns martial arts to defend himself against bullies.'
      },
      {
        id: 1003,
        title: 'Cyberbully',
        posterPath: 'https://image.tmdb.org/t/p/w500/8QJJKwJNuBXgHLcMCkpZnBcCvNH.jpg',
        year: '2011',
        description: 'A teenager faces the devastating effects of cyberbullying.'
      },
      {
        id: 1004,
        title: 'Mean Girls',
        posterPath: 'https://image.tmdb.org/t/p/w500/fXm3YKXAEjx7d2tIWDg9TfRZtsU.jpg',
        year: '2004',
        description: 'A new student navigates the complex social hierarchy of high school.'
      }
    ]
  },
  {
    id: 'environmental-awareness',
    title: 'Environmental Awareness',
    description: 'Films highlighting environmental issues and conservation',
    movies: [
      {
        id: 2001,
        title: 'WALL-E',
        posterPath: 'https://image.tmdb.org/t/p/w500/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg',
        year: '2008',
        description: 'A robot left to clean Earth discovers the importance of environmental care.'
      },
      {
        id: 2002,
        title: 'An Inconvenient Truth',
        posterPath: 'https://image.tmdb.org/t/p/w500/ml8VLzOhkQdSCJhBTyOlayNzJkI.jpg',
        year: '2006',
        description: 'Al Gore presents compelling evidence about climate change.'
      },
      {
        id: 2003,
        title: 'The Lorax',
        posterPath: 'https://image.tmdb.org/t/p/w500/tePFnZFw5L7lQgGzFpZbTgR6RJh.jpg',
        year: '2012',
        description: 'A young boy learns about environmental protection from the Lorax.'
      },
      {
        id: 2004,
        title: 'FernGully',
        posterPath: 'https://image.tmdb.org/t/p/w500/eTqb6NJmw8bVQP0LSLGFtJNjaqb.jpg',
        year: '1992',
        description: 'Fairies fight to save their rainforest home from destruction.'
      }
    ]
  },
  {
    id: 'mental-health',
    title: 'Mental Health',
    description: 'Stories promoting mental health awareness and support',
    movies: [
      {
        id: 3001,
        title: 'Inside Out',
        posterPath: 'https://image.tmdb.org/t/p/w500/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg',
        year: '2015',
        description: 'A journey through the emotions of a young girl dealing with change.'
      },
      {
        id: 3002,
        title: 'A Beautiful Mind',
        posterPath: 'https://image.tmdb.org/t/p/w500/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'The story of mathematician John Nash and his struggle with mental illness.'
      },
      {
        id: 3003,
        title: 'Good Will Hunting',
        posterPath: 'https://image.tmdb.org/t/p/w500/bABCBKYBK7A5G1x0FzoeoNfuj2.jpg',
        year: '1997',
        description: 'A janitor with extraordinary mathematical abilities receives therapy.'
      },
      {
        id: 3004,
        title: 'The Perks of Being a Wallflower',
        posterPath: 'https://image.tmdb.org/t/p/w500/n0s2kFUP0zr8q5sMKhJJhZUAMlN.jpg',
        year: '2012',
        description: 'A shy teenager finds friendship and learns to cope with trauma.'
      }
    ]
  },
  {
    id: 'diversity-inclusion',
    title: 'Diversity & Inclusion',
    description: 'Celebrating diversity and promoting inclusion',
    movies: [
      {
        id: 4001,
        title: 'Coco',
        posterPath: 'https://image.tmdb.org/t/p/w500/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg',
        year: '2017',
        description: 'A boy discovers his family history and Mexican traditions.'
      },
      {
        id: 4002,
        title: 'Black Panther',
        posterPath: 'https://image.tmdb.org/t/p/w500/uxzzxijgPIY7slzFvMotPv8wjKA.jpg',
        year: '2018',
        description: 'A superhero story celebrating African culture and heritage.'
      },
      {
        id: 4003,
        title: 'Moana',
        posterPath: 'https://image.tmdb.org/t/p/w500/4JeejGugONWpJkbnvL12hVoYEDa.jpg',
        year: '2016',
        description: 'A Polynesian princess embarks on a journey to save her island.'
      },
      {
        id: 4004,
        title: 'The Help',
        posterPath: 'https://image.tmdb.org/t/p/w500/7XLSwxpfpPPZVEiB7VTMzUtzRdg.jpg',
        year: '2011',
        description: 'African American maids share their stories during the civil rights era.'
      }
    ]
  },
  {
    id: 'social-justice',
    title: 'Social Justice',
    description: 'Films addressing social issues and promoting equality',
    movies: [
      {
        id: 5001,
        title: 'Selma',
        posterPath: 'https://image.tmdb.org/t/p/w500/wq4lhMB4WP8xVlbTNz8V1VQO5P8.jpg',
        year: '2014',
        description: 'The story of Martin Luther King Jr. and the Selma voting rights marches.'
      },
      {
        id: 5002,
        title: 'Hidden Figures',
        posterPath: 'https://image.tmdb.org/t/p/w500/9lfz2W2uGjyow3am00rsPJ8iOyq.jpg',
        year: '2016',
        description: 'African American women mathematicians at NASA during the space race.'
      },
      {
        id: 5003,
        title: 'To Kill a Mockingbird',
        posterPath: 'https://image.tmdb.org/t/p/w500/hKbhJJRRZOUP4Ky7TcXBBaLNzB4.jpg',
        year: '1962',
        description: 'A lawyer defends a black man in a racially charged trial.'
      },
      {
        id: 5004,
        title: 'The Hate U Give',
        posterPath: 'https://image.tmdb.org/t/p/w500/2icwBom0t5nmOuZI9FVXF3gkMK0.jpg',
        year: '2018',
        description: 'A teenager witnesses police brutality and finds her voice.'
      }
    ]
  },
  {
    id: 'education-empowerment',
    title: 'Education & Empowerment',
    description: 'Stories about the power of education and personal growth',
    movies: [
      {
        id: 6001,
        title: 'Dead Poets Society',
        posterPath: 'https://image.tmdb.org/t/p/w500/ai40gM7SUaGA2pPvbBmRe8Ew8wN.jpg',
        year: '1989',
        description: 'An inspiring teacher encourages students to think for themselves.'
      },
      {
        id: 6002,
        title: 'Freedom Writers',
        posterPath: 'https://image.tmdb.org/t/p/w500/7sOgj2mNqHBUXq6M1ESWGlHZG8c.jpg',
        year: '2007',
        description: 'A teacher transforms her students lives through writing.'
      },
      {
        id: 6003,
        title: 'The Pursuit of Happyness',
        posterPath: 'https://image.tmdb.org/t/p/w500/12vF4nYdYGpBtz6vkmrBgWu6ZXs.jpg',
        year: '2006',
        description: 'A father struggles to build a better life for his son.'
      },
      {
        id: 6004,
        title: 'Matilda',
        posterPath: 'https://image.tmdb.org/t/p/w500/lqiLtJi0WkMASuGGaygq1feVOTr.jpg',
        year: '1996',
        description: 'A gifted girl uses her intelligence to overcome adversity.'
      }
    ]
  },
  {
    id: 'community-support',
    title: 'Community Support',
    description: 'Movies about the importance of community and helping others',
    movies: [
      {
        id: 7001,
        title: 'Its a Wonderful Life',
        posterPath: 'https://image.tmdb.org/t/p/w500/bSqt9rhDZx1Q7UZ86dBPKdNomp2.jpg',
        year: '1946',
        description: 'A man discovers how much his life has touched others.'
      },
      {
        id: 7002,
        title: 'Pay It Forward',
        posterPath: 'https://image.tmdb.org/t/p/w500/2dABNdJRSaXaVlmLqJkKgOJXVL7.jpg',
        year: '2000',
        description: 'A boy starts a movement of kindness that spreads across the country.'
      },
      {
        id: 7003,
        title: 'The Blind Side',
        posterPath: 'https://image.tmdb.org/t/p/w500/k2MKCf6fLbuXdOKuvaG5jc6NbJq.jpg',
        year: '2009',
        description: 'A family takes in a homeless teenager and changes his life.'
      },
      {
        id: 7004,
        title: 'Remember the Titans',
        posterPath: 'https://image.tmdb.org/t/p/w500/pAa5mVvB8eLOyNJzqjwjkzjOqbG.jpg',
        year: '2000',
        description: 'A football team overcomes racial tensions to unite as one.'
      }
    ]
  }
];